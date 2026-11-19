import {
  AssemblyConstraint,
  CompiledPattern,
  PieceSummary,
  SolvedGeometry,
  STITCH_DIMENSIONS,
  StitchNode,
} from '../model/types';

interface DistanceConstraint {
  a: number;
  b: number;
  restLength: number;
  compliance: number;
  isPrimaryPost: boolean;
  enforceUpwardY: boolean;
}

export interface SolveOptions {
  iterations?: number;
  stuffingOverride?: boolean | null;
}

function evalPolyline(points: [number, number, number][], t: number): {
  pos: [number, number, number];
  tangent: [number, number, number];
} {
  if (points.length === 0) {
    return { pos: [0, 0, 0], tangent: [0, 1, 0] };
  }
  if (points.length === 1) {
    return { pos: [...points[0]], tangent: [0, 1, 0] };
  }
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (points.length - 1);
  const seg = Math.min(points.length - 2, Math.floor(scaled));
  const frac = scaled - seg;
  const p0 = points[seg];
  const p1 = points[seg + 1];
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const dz = p1[2] - p0[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  return {
    pos: [p0[0] + dx * frac, p0[1] + dy * frac, p0[2] + dz * frac],
    tangent: [dx / len, dy / len, dz / len],
  };
}

function rotateEuler(
  v: [number, number, number],
  euler: [number, number, number]
): [number, number, number] {
  let [x, y, z] = v;
  const [rx, ry, rz] = euler;
  if (rx !== 0) {
    const c = Math.cos(rx);
    const s = Math.sin(rx);
    const ny = y * c - z * s;
    const nz = y * s + z * c;
    y = ny;
    z = nz;
  }
  if (ry !== 0) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const nx = x * c + z * s;
    const nz = -x * s + z * c;
    x = nx;
    z = nz;
  }
  if (rz !== 0) {
    const c = Math.cos(rz);
    const s = Math.sin(rz);
    const nx = x * c - y * s;
    const ny = x * s + y * c;
    x = nx;
    y = ny;
  }
  return [x, y, z];
}

/**
 * Constructively seeds 3D coordinates piece-by-piece and row-by-row
 * before XPBD constraint relaxation refines local stitch spacing, curvature, and buckling.
 */
function seedInitialPositions(pattern: CompiledPattern, pos: Float32Array): void {
  const { stitches, rows, pieces } = pattern;

  for (const piece of pieces) {
    const pieceRows = rows.filter((r) => r.pieceId === piece.id);
    if (pieceRows.length === 0) continue;

    const startsInRound =
      piece.stitchIds.some((id) => stitches[id].kind === 'magic_ring') ||
      pieceRows.some((r) => r.workMode !== 'flat_rows');

    if (piece.workMode === 'flat_rows' && !startsInRound) {
      seedFlatPiece(piece, pieceRows, stitches, pos);
    } else {
      seedRoundPiece(piece, pieceRows, stitches, pos);
    }
  }
}

function seedFlatPiece(
  piece: PieceSummary,
  pieceRows: CompiledPattern['rows'],
  stitches: StitchNode[],
  pos: Float32Array
): void {
  // Check if piece has short rows (some internal rows much narrower than parent row)
  let currentY = 0;

  for (let rIdx = 0; rIdx < pieceRows.length; rIdx++) {
    const row = pieceRows[rIdx];
    const rowIds: number[] = [];
    for (let id = row.firstStitchId; id <= row.lastStitchId; id++) {
      if (stitches[id].pieceId === piece.id) {
        rowIds.push(id);
      }
    }
    if (rowIds.length === 0) continue;

    if (row.isBorder) {
      // Seed border stitches slightly outward from centroid around their anchor stitch!
      let cx = 0;
      let cy = 0;
      let count = 0;
      for (const id of piece.stitchIds) {
        if (id >= row.firstStitchId) break;
        cx += pos[id * 3];
        cy += pos[id * 3 + 1];
        count++;
      }
      if (count > 0) {
        cx /= count;
        cy /= count;
      }

      const anchorFanCounter = new Map<number, number>();
      for (const id of rowIds) {
        const st = stitches[id];
        const anc = st.anchors[0];
        if (anc) {
          const ax = pos[anc.targetStitchId * 3];
          const ay = pos[anc.targetStitchId * 3 + 1];
          const az = pos[anc.targetStitchId * 3 + 2];
          let dx = ax - cx;
          let dy = ay - cy;
          const dLen = Math.hypot(dx, dy) || 1;
          dx /= dLen;
          dy /= dLen;
          // Tangential fan offset when placing 2 sc in a corner!
          const seenIdx = anchorFanCounter.get(anc.targetStitchId) ?? 0;
          anchorFanCounter.set(anc.targetStitchId, seenIdx + 1);
          const tx = -dy * (seenIdx - 0.35) * 0.45;
          const ty = dx * (seenIdx - 0.35) * 0.45;
          const h = STITCH_DIMENSIONS[st.kind].height * 0.85;
          pos[id * 3] = ax + dx * h + tx;
          pos[id * 3 + 1] = ay + dy * h + ty;
          pos[id * 3 + 2] = az;
        }
      }
      continue;
    }

    const foundationInRow = rowIds.filter(
      (id) =>
        stitches[id].kind === 'ch' &&
        stitches[id].anchors.length === 0 &&
        stitches[id].label.startsWith('foundation')
    );

    if (foundationInRow.length > 0) {
      // Lay out foundation chains along +X centered at 0 (at Y = 0)
      const unskippedFoundation = foundationInRow.filter((id) => !stitches[id].isTurningChain);
      const skippedFoundation = foundationInRow.filter((id) => stitches[id].isTurningChain);
      const baseChainCount = Math.max(1, unskippedFoundation.length);
      const halfSpan = ((baseChainCount - 1) * 1.0) / 2;

      for (let k = 0; k < unskippedFoundation.length; k++) {
        const id = unskippedFoundation[k];
        pos[id * 3] = -halfSpan + k * 1.0;
        pos[id * 3 + 1] = 0;
        pos[id * 3 + 2] = 0;
      }
      // Place any skipped "from hook" chains neatly climbing at the right end of the foundation chain
      const rightEdgeX = halfSpan + 0.35;
      for (let s = 0; s < skippedFoundation.length; s++) {
        const sid = skippedFoundation[s];
        pos[sid * 3] = rightEdgeX;
        pos[sid * 3 + 1] = (s + 1) * 0.32;
        pos[sid * 3 + 2] = 0;
      }
      currentY = 0.35;
    }

    const activeIds = rowIds.filter(
      (id) => !stitches[id].isTurningChain && !foundationInRow.includes(id)
    );
    const turningIds = rowIds.filter(
      (id) => stitches[id].isTurningChain && !foundationInRow.includes(id)
    );

    if (activeIds.length === 0) {
      continue;
    }

    // Compute average stitch height of this row
    const avgH =
      activeIds.reduce((acc, id) => acc + STITCH_DIMENSIONS[stitches[id].kind].height, 0) /
      activeIds.length;

    // Determine whether activeIds traverses Left-to-Right or Right-to-Left from parent anchor X positions!
    const isWS = !stitches[activeIds[0]].isRightSide;
    let shouldReverseForLr = isWS;
    const firstWithAnchor = activeIds.find((id) => stitches[id].anchors.length > 0);
    const lastWithAnchor = [...activeIds].reverse().find((id) => stitches[id].anchors.length > 0);
    if (firstWithAnchor !== undefined && lastWithAnchor !== undefined && firstWithAnchor !== lastWithAnchor) {
      const xFirst = pos[stitches[firstWithAnchor].anchors[0].targetStitchId * 3];
      const xLast = pos[stitches[lastWithAnchor].anchors[0].targetStitchId * 3];
      if (Math.abs(xFirst - xLast) > 0.25) {
        shouldReverseForLr = xFirst > xLast;
      }
    }

    const orderedLr = shouldReverseForLr ? [...activeIds].reverse() : activeIds;
    const totalWidth = orderedLr.reduce(
      (acc, id) => acc + STITCH_DIMENSIONS[stitches[id].kind].width,
      0
    );

    // Center row over the average X of its parent anchors!
    let anchorMeanX = 0;
    let anchorMeanY = currentY;
    let anchorMeanZ = 0;
    let ancCount = 0;
    for (const id of orderedLr) {
      for (const a of stitches[id].anchors) {
        anchorMeanX += pos[a.targetStitchId * 3];
        anchorMeanY += pos[a.targetStitchId * 3 + 1];
        anchorMeanZ += pos[a.targetStitchId * 3 + 2];
        ancCount++;
      }
    }
    if (ancCount > 0) {
      anchorMeanX /= ancCount;
      anchorMeanY /= ancCount;
      anchorMeanZ /= ancCount;
    }

    let cursorX = anchorMeanX - (totalWidth - STITCH_DIMENSIONS[stitches[orderedLr[0]].kind].width) / 2;
    for (let k = 0; k < orderedLr.length; k++) {
      const id = orderedLr[k];
      const st = stitches[id];
      const dim = STITCH_DIMENSIONS[st.kind];

      // Determine parent Y so mixed-height rows (like Row 12 shield crest!) arch accurately above parents!
      let parentY = anchorMeanY;
      let parentZ = anchorMeanZ;
      if (st.anchors.length > 0) {
        parentY =
          st.anchors.reduce((s, a) => s + pos[a.targetStitchId * 3 + 1], 0) / st.anchors.length;
        parentZ =
          st.anchors.reduce((s, a) => s + pos[a.targetStitchId * 3 + 2], 0) / st.anchors.length;
      }

      // Out-of-plane subtle relief for FLO / BLO / Post / Bobble stitches!
      let zOffset = isWS ? -0.04 : 0.04;
      const primarySite = st.anchors[0]?.site;
      if (primarySite === 'blo') zOffset -= 0.35;
      else if (primarySite === 'flo') zOffset += 0.35;
      else if (primarySite === 'front_post') zOffset += 0.55;
      else if (primarySite === 'back_post') zOffset -= 0.55;
      if (dim.bulge > 0) zOffset += (st.isRightSide ? 1 : -1) * dim.bulge;

      pos[id * 3] = cursorX;
      pos[id * 3 + 1] = parentY + dim.height;
      pos[id * 3 + 2] = parentZ + zOffset;
      cursorX += dim.width;
    }

    // Place turning chains climbing vertically along the start edge between parent and first stitch of row
    for (let t = 0; t < turningIds.length; t++) {
      const tid = turningIds[t];
      const firstWorkedId = activeIds[0];
      if (firstWorkedId !== undefined) {
        const topX = pos[firstWorkedId * 3];
        const topY = pos[firstWorkedId * 3 + 1];
        const topZ = pos[firstWorkedId * 3 + 2];
        const parentAnc = stitches[firstWorkedId].anchors[0]?.targetStitchId;
        const botY = parentAnc !== undefined ? pos[parentAnc * 3 + 1] : topY - avgH;
        const edgeSign = shouldReverseForLr ? 1 : -1;
        const frac = (t + 1) / (turningIds.length + 1);
        pos[tid * 3] = topX + edgeSign * 0.42;
        pos[tid * 3 + 1] = botY + (topY - botY) * frac;
        pos[tid * 3 + 2] = topZ;
      }
    }

    currentY = anchorMeanY + avgH;
  }
}

function seedRoundPiece(
  piece: PieceSummary,
  pieceRows: CompiledPattern['rows'],
  stitches: StitchNode[],
  pos: Float32Array
): void {
  // Check if this round piece started on a linear foundation chain (3D Oval!)
  const firstRow = pieceRows[0];
  const foundationChains: number[] = [];
  for (let id = firstRow.firstStitchId; id <= firstRow.lastStitchId; id++) {
    if (stitches[id].kind === 'ch' && stitches[id].anchors.length === 0) {
      foundationChains.push(id);
    }
  }
  const hasUndersidePivot = piece.stitchIds.some((id) =>
    stitches[id].anchors.some((a) => a.site === 'chain_underside')
  );
  const isOvalFoundation = foundationChains.length >= 3 && hasUndersidePivot;

  let prevRadius = 0.25;
  let currentY = 0;
  // Place magic ring at origin if present
  for (const id of piece.stitchIds) {
    if (stitches[id].kind === 'magic_ring') {
      pos[id * 3] = 0;
      pos[id * 3 + 1] = 0;
      pos[id * 3 + 2] = 0;
    }
  }

  // If Oval foundation, place usable foundation chains along X spine in XZ plane
  const usableOvalChains = foundationChains.filter((id) => !stitches[id].isTurningChain);
  const skippedOvalChains = foundationChains.filter((id) => stitches[id].isTurningChain);
  const ovalSpineHalfLen = isOvalFoundation
    ? (Math.max(1, usableOvalChains.length - 1) * 0.92) / 2
    : 0;

  if (isOvalFoundation) {
    for (let k = 0; k < usableOvalChains.length; k++) {
      const cid = usableOvalChains[k];
      pos[cid * 3] = -ovalSpineHalfLen + k * 0.92;
      pos[cid * 3 + 1] = 0;
      pos[cid * 3 + 2] = 0;
    }
    for (const sid of skippedOvalChains) {
      pos[sid * 3] = ovalSpineHalfLen + 0.35;
      pos[sid * 3 + 1] = 0.05;
      pos[sid * 3 + 2] = 0.25;
    }
  }

  const isFlatJoinedMotif =
    piece.workMode === 'joined_rounds' &&
    !piece.stuffed &&
    !piece.stitchIds.some((id) => stitches[id].anchors[0]?.site === 'blo');

  for (let rIdx = 0; rIdx < pieceRows.length; rIdx++) {
    const row = pieceRows[rIdx];
    const ringIds: number[] = [];
    const turningIds: number[] = [];

    for (let id = row.firstStitchId; id <= row.lastStitchId; id++) {
      const st = stitches[id];
      if (st.pieceId !== piece.id || st.kind === 'magic_ring') continue;
      if (isOvalFoundation && foundationChains.includes(id)) continue;
      if (st.isTurningChain) {
        turningIds.push(id);
      } else {
        ringIds.push(id);
      }
    }

    if (ringIds.length === 0) continue;

    const circumference = ringIds.reduce(
      (acc, id) => acc + STITCH_DIMENSIONS[stitches[id].kind].width,
      0
    );
    const avgHeight =
      ringIds.reduce((acc, id) => acc + STITCH_DIMENSIONS[stitches[id].kind].height, 0) /
      ringIds.length;

    // Check if round is predominantly BLO (e.g. structured basket wall turn!)
    const bloFraction =
      ringIds.filter((id) => stitches[id].anchors[0]?.site === 'blo').length / ringIds.length;

    // Stadium/oval perimeter: P = 4 * spineHalfLen + 2 * pi * R
    const effectiveSpineHalf = ovalSpineHalfLen;
    const rawTargetRadius = Math.max(
      0.85,
      (circumference - 4 * effectiveSpineHalf) / (2 * Math.PI)
    );

    let targetRadius = rawTargetRadius;
    let deltaY = 0;
    let hyperbolicAmplitude = 0;

    if (rIdx === 0 || (rIdx === 1 && pieceRows[0].emittedStitchCount === 0)) {
      // First real round around Magic Ring or Oval spine
      targetRadius = Math.max(0.55, rawTargetRadius);
      deltaY = isFlatJoinedMotif ? 0 : 0.08;
    } else if (isFlatJoinedMotif) {
      // Flat lace medallion / granny square motif: radiates outward in the XZ plane!
      targetRadius = prevRadius + avgHeight * 0.92;
      deltaY = 0;
    } else if (bloFraction > 0.6) {
      // Crisp 90-degree BLO wall turn!
      targetRadius = prevRadius * 0.98;
      deltaY = avgHeight * 0.96;
    } else {
      const radialDiff = rawTargetRadius - prevRadius;
      if (radialDiff > avgHeight * 1.08) {
        // Hyperbolic over-increase! Radius can't grow faster than stitch post height; excess circumference buckles into 3D saddle waves!
        targetRadius = prevRadius + avgHeight * 0.86;
        deltaY = avgHeight * 0.22;
        const excessRatio = circumference / Math.max(1, 2 * Math.PI * targetRadius) - 1;
        hyperbolicAmplitude = Math.min(2.6, Math.sqrt(Math.max(0, excessRatio)) * 1.65 * avgHeight);
      } else if (radialDiff >= avgHeight * 0.92) {
        // Flat outward disc growth: lies nearly in plane
        targetRadius = prevRadius + avgHeight * 0.95;
        deltaY = avgHeight * 0.06;
      } else if (radialDiff <= -avgHeight * 0.85) {
        // Steep inward decrease round (e.g. 30 sts -> 20 sts): still climbs upward (+Y) by at least 0.52 * avgHeight while tapering inward!
        targetRadius = Math.max(rawTargetRadius, prevRadius - avgHeight * 0.85);
        deltaY = avgHeight * 0.58;
      } else {
        // Spherical / Conical / Cylindrical 3D shaping!
        targetRadius = rawTargetRadius;
        deltaY = Math.sqrt(Math.max(0.25 * avgHeight * avgHeight, avgHeight * avgHeight - radialDiff * radialDiff));
      }
    }

    currentY += deltaY;

    // Check if Granny Square (4 distinct ch-2 corner chain spaces!)
    const rowChainSpaces = patternChainSpacesInRow(ringIds, stitches);
    const isSquareMotif = rowChainSpaces.length === 4 && !piece.stuffed;

    const n = ringIds.length;
    // Coherent base lobe count (5 primary saddle lobes + phase-locked 10-lobe period-doubling harmonic on outer rounds)
    // so parent and child rounds stay 100% in phase all 360 degrees around without beat-frequency cancellation!
    const baseLobes = 5;

    // Special exact stadium-oval seeding when working around an Oval Foundation chain!
    if (isOvalFoundation) {
      const leftEndChainId = usableOvalChains[0];
      const rightEndChainId = usableOvalChains[usableOvalChains.length - 1];
      const isFirstOvalRound =
        ringIds.some((id) => foundationChains.includes(stitches[id].anchors[0]?.targetStitchId ?? -1));

      if (isFirstOvalRound) {
        const leftTipIds = ringIds.filter(
          (id) => stitches[id].anchors[0]?.targetStitchId === leftEndChainId
        );
        const rightTipIds = ringIds.filter(
          (id) => stitches[id].anchors[0]?.targetStitchId === rightEndChainId
        );

        for (let k = 0; k < n; k++) {
          const id = ringIds[k];
          const st = stitches[id];
          const anc = st.anchors[0];
          const ancId = anc?.targetStitchId ?? leftEndChainId;
          const cx = pos[ancId * 3];

          let x = cx;
          let z = 0;
          if (ancId === leftEndChainId) {
            const idxInTip = Math.max(0, leftTipIds.indexOf(id));
            const countInTip = Math.max(1, leftTipIds.length);
            // Fan around left semicircle: +pi/2 -> 3*pi/2
            const angle = Math.PI * 0.55 + (idxInTip / Math.max(1, countInTip - 1)) * (Math.PI * 0.9);
            x = cx + Math.cos(angle) * targetRadius;
            z = Math.sin(angle) * targetRadius;
          } else if (ancId === rightEndChainId) {
            // Stitch 0 is top-right (+60 deg), trailing stitches wrap bottom-right (-60 deg -> 0 deg)
            const idxInTip = Math.max(0, rightTipIds.indexOf(id));
            const angles = [Math.PI * 0.32, -Math.PI * 0.35, -Math.PI * 0.04, Math.PI * 0.15];
            const angle = angles[idxInTip % angles.length];
            x = cx + Math.cos(angle) * targetRadius;
            z = Math.sin(angle) * targetRadius;
          } else {
            // Straight middle spine chain: +Z on initial top pass, -Z on opposite underside pass!
            const signZ = anc?.site === 'chain_underside' ? -1 : 1;
            x = cx;
            z = signZ * targetRadius;
          }

          pos[id * 3] = x;
          pos[id * 3 + 1] = currentY;
          pos[id * 3 + 2] = z;
        }
      } else {
        // Subsequent oval rounds (Rnd 2+): grow directly above/outward from parent stitch in Rnd r-1!
        const radialStep =
          bloFraction > 0.6 || Math.abs(targetRadius - prevRadius) < 0.12
            ? 0
            : Math.max(0, targetRadius - prevRadius);

        // Count how many children share each parent stitch (for clean tangential fan on `inc`)
        const childrenByParent = new Map<number, number[]>();
        for (const id of ringIds) {
          const pid = stitches[id].anchors[0]?.targetStitchId ?? id;
          const list = childrenByParent.get(pid) ?? [];
          list.push(id);
          childrenByParent.set(pid, list);
        }

        for (let k = 0; k < n; k++) {
          const id = ringIds[k];
          const st = stitches[id];
          const pid = st.anchors[0]?.targetStitchId ?? id;
          const px = pos[pid * 3];
          const pz = pos[pid * 3 + 2];

          // Outward stadium normal from nearest spine point `clampedSpineX`
          const clampedSpineX = Math.max(-ovalSpineHalfLen, Math.min(ovalSpineHalfLen, px));
          let nx = px - clampedSpineX;
          let nz = pz;
          const nLen = Math.hypot(nx, nz) || 1;
          nx /= nLen;
          nz /= nLen;

          // Tangential fan when 2+ children share the same parent (`inc`)
          const siblings = childrenByParent.get(pid) ?? [id];
          const sibIdx = siblings.indexOf(id);
          const fanOffset =
            siblings.length > 1 ? (sibIdx - (siblings.length - 1) / 2) * 0.48 : 0;
          const tx = -nz;
          const tz = nx;

          const frac = k / n;
          const spiralLift =
            piece.workMode === 'spiral_rounds' ? (frac - 0.5) * deltaY * 0.45 : 0;

          pos[id * 3] = px + nx * radialStep + tx * fanOffset;
          pos[id * 3 + 1] = currentY + spiralLift;
          pos[id * 3 + 2] = pz + nz * radialStep + tz * fanOffset;
        }
      }

      prevRadius = targetRadius;
      continue;
    }

    if (row.workMode === 'flat_rows' && rIdx > 0) {
      // Partial flat flap row attached to a round cap (e.g., Hair Rows 13-15 neck flap):
      // seed each stitch directly above its parent anchor on the cylinder rim!
      currentY += avgHeight * 0.96;
      for (let k = 0; k < n; k++) {
        const id = ringIds[k];
        const st = stitches[id];
        const ancId = st.anchors[0]?.targetStitchId;
        if (ancId !== undefined && ancId < id) {
          pos[id * 3] = pos[ancId * 3];
          pos[id * 3 + 1] = pos[ancId * 3 + 1] + STITCH_DIMENSIONS[st.kind].height * 0.96;
          pos[id * 3 + 2] = pos[ancId * 3 + 2];
        } else {
          const theta = (k / Math.max(1, n)) * Math.PI;
          pos[id * 3] = Math.cos(theta) * prevRadius;
          pos[id * 3 + 1] = currentY;
          pos[id * 3 + 2] = Math.sin(theta) * prevRadius;
        }
      }
      for (let t = 0; t < turningIds.length; t++) {
        const tid = turningIds[t];
        const baseId = stitches[tid].prevStitchId ?? ringIds[0];
        pos[tid * 3] = pos[baseId * 3];
        pos[tid * 3 + 1] = pos[baseId * 3 + 1] + 0.35;
        pos[tid * 3 + 2] = pos[baseId * 3 + 2];
      }
      continue;
    }

    for (let k = 0; k < n; k++) {
      const id = ringIds[k];
      const st = stitches[id];
      const frac = k / n;
      const theta = frac * Math.PI * 2;

      // For flat lace motifs with mixed stitch heights in the same round (e.g. 2 dc, picot, 2 dc, sl st),
      // let individual stitch post height modulate local radius so petals arch outward and sl_st valleys dip inward!
      let localRadius = targetRadius;
      if (isFlatJoinedMotif && rIdx > 0) {
        const stH = STITCH_DIMENSIONS[st.kind].height;
        localRadius = prevRadius + stH * 0.95;
      }

      let x = 0;
      let z = 0;
      if (isSquareMotif) {
        // Subtle squaring factor for 4-corner motifs so corners look crisp right from seed
        const sq =
          1 /
          Math.max(
            Math.abs(Math.cos(theta - Math.PI / 4)),
            Math.abs(Math.sin(theta - Math.PI / 4))
          );
        const rBlend = localRadius * (0.72 + 0.28 * sq);
        x = Math.cos(theta) * rBlend;
        z = Math.sin(theta) * rBlend;
      } else if (effectiveSpineHalf > 0.05) {
        // Stadium oval parameterization in XZ!
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        x =
          Math.sign(cosT) * effectiveSpineHalf * Math.pow(Math.abs(cosT), 0.55) +
          cosT * localRadius;
        z = sinT * localRadius;
      } else {
        x = Math.cos(theta) * localRadius;
        z = Math.sin(theta) * localRadius;
      }

      // Post-stitch radial relief (`FPdc` pops outward, `BPdc` recesses inward!)
      const site = st.anchors[0]?.site;
      let radialBump = 0;
      if (site === 'front_post') radialBump = 0.42;
      else if (site === 'back_post') radialBump = -0.35;
      else if (site === 'flo') radialBump = 0.16;
      else if (site === 'blo') radialBump = -0.14;
      if (STITCH_DIMENSIONS[st.kind].bulge > 0) {
        radialBump += STITCH_DIMENSIONS[st.kind].bulge * 0.7;
      }

      if (radialBump !== 0) {
        const rLen = Math.hypot(x, z) || 1;
        x += (x / rLen) * radialBump;
        z += (z / rLen) * radialBump;
      }

      // Spiral continuous-round gentle vertical ramp + phase-coherent 360-degree hyperbolic saddle wave
      const spiralLift =
        piece.workMode === 'spiral_rounds' ? (frac - 0.5) * deltaY * 0.55 : 0;
      const harmonicWeight = rIdx >= 5 ? 0.35 : 0;
      const saddleWave =
        hyperbolicAmplitude > 0
          ? (Math.sin(theta * baseLobes) * 0.8 +
              Math.sin(theta * baseLobes * 2) * harmonicWeight) *
            hyperbolicAmplitude
          : 0;

      pos[id * 3] = x;
      pos[id * 3 + 1] = currentY + spiralLift + saddleWave;
      pos[id * 3 + 2] = z;
    }

    // Place picots, turning chains, and join slip stitches relative to their true adjacent/base stitch (never teleporting to ringIds[0]!)
    for (let t = 0; t < turningIds.length; t++) {
      const tid = turningIds[t];
      const tst = stitches[tid];
      const baseId = tst.anchors[0]?.targetStitchId ?? tst.prevStitchId ?? ringIds[0];
      const bx = pos[baseId * 3];
      const by = pos[baseId * 3 + 1];
      const bz = pos[baseId * 3 + 2];
      const bRad = Math.hypot(bx, bz) || 1;
      const ux = bx / bRad;
      const uz = bz / bRad;

      if (tst.label.startsWith('picot ch')) {
        // Fan picot chains outward into a small teardrop peak at the tip of the petal
        const pStep = Number(tst.label.replace(/\D+/g, '')) || 1;
        const outBoost = pStep === 2 ? 0.68 : 0.36;
        const sideShift = pStep === 1 ? -0.22 : pStep === 3 ? 0.22 : 0;
        pos[tid * 3] = bx + ux * outBoost - uz * sideShift;
        pos[tid * 3 + 1] = by;
        pos[tid * 3 + 2] = bz + uz * outBoost + ux * sideShift;
      } else if (tst.label === 'sl st (close picot)') {
        pos[tid * 3] = bx + ux * 0.12;
        pos[tid * 3 + 1] = by;
        pos[tid * 3 + 2] = bz + uz * 0.12;
      } else {
        // Standard turning chain or round join slip stitch
        const prevId = tst.prevStitchId ?? baseId;
        pos[tid * 3] = (pos[prevId * 3] + bx) * 0.5;
        pos[tid * 3 + 1] = (pos[prevId * 3 + 1] + by) * 0.5;
        pos[tid * 3 + 2] = (pos[prevId * 3 + 2] + bz) * 0.5;
      }
    }

    prevRadius = targetRadius;
  }
}

function patternChainSpacesInRow(ringIds: number[], stitches: StitchNode[]): number[] {
  const ids = new Set<number>();
  for (const id of ringIds) {
    const cs = stitches[id].chainSpaceId;
    if (cs !== undefined) ids.add(cs);
  }
  return [...ids];
}

function buildDistanceConstraints(pattern: CompiledPattern): DistanceConstraint[] {
  const { stitches, pieces } = pattern;
  const constraints: DistanceConstraint[] = [];
  const flatOrHyperbolicPieces = new Set<string>();
  for (const p of pieces) {
    const isFlatJoined =
      p.workMode === 'joined_rounds' &&
      !p.stuffed &&
      !p.stitchIds.some((id) => stitches[id].anchors[0]?.site === 'blo');
    const hasDecreases = p.stitchIds.some((id) => stitches[id].anchors.length > 1);
    if (isFlatJoined || (!p.stuffed && !hasDecreases && p.workMode !== 'flat_rows')) {
      flatOrHyperbolicPieces.add(p.id);
    }
  }

  for (const st of stitches) {
    const dim = STITCH_DIMENSIONS[st.kind];
    const isFlatOrHyperbolic = flatOrHyperbolicPieces.has(st.pieceId);

    // 1. Working-yarn sequential edge
    if (st.prevStitchId !== null && stitches[st.prevStitchId]?.pieceId === st.pieceId) {
      const restW = st.isTurningChain ? dim.height * 0.85 : dim.width * 0.95;
      constraints.push({
        a: st.prevStitchId,
        b: st.id,
        restLength: Math.max(0.2, restW),
        compliance: st.isTurningChain ? 0.08 : 0.015,
        isPrimaryPost: false,
        enforceUpwardY: false,
      });
    }

    // 2. Anchor post edge(s) into parent stitch(es)
    for (let k = 0; k < st.anchors.length; k++) {
      const anc = st.anchors[k];
      if (anc.targetStitchId >= 0 && anc.targetStitchId < stitches.length) {
        const restH = anc.site === 'ring_center' ? 0.85 : Math.max(0.25, dim.height * 0.96);
        const parentSt = stitches[anc.targetStitchId];
        const enforceUpwardY =
          k === 0 &&
          !isFlatOrHyperbolic &&
          !st.isTurningChain &&
          anc.site !== 'ring_center' &&
          anc.site !== 'row_end_post' &&
          parentSt.rowNumber < st.rowNumber;
        constraints.push({
          a: anc.targetStitchId,
          b: st.id,
          restLength: restH,
          compliance: anc.site === 'chain_space' ? 0.05 : 0.012,
          isPrimaryPost: k === 0,
          enforceUpwardY,
        });
      }
    }
  }

  return constraints;
}

/**
 * Spatial-hash short-range repulsion ($O(N)$) so stitches don't collapse onto one another
 * and hyperbolic surfaces maintain clean non-self-intersecting 3D waves.
 */
function applyShortRangeRepulsion(
  pieceStitchIds: number[],
  pos: Float32Array,
  pinned: Uint8Array,
  minDist: number
): void {
  if (pieceStitchIds.length < 4 || pieceStitchIds.length > 4000) return;

  const cellSize = minDist;
  const grid = new Map<number, number[]>();
  const hashCell = (cx: number, cy: number, cz: number): number =>
    ((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)) | 0;

  for (const id of pieceStitchIds) {
    const cx = Math.floor(pos[id * 3] / cellSize);
    const cy = Math.floor(pos[id * 3 + 1] / cellSize);
    const cz = Math.floor(pos[id * 3 + 2] / cellSize);
    const h = hashCell(cx, cy, cz);
    let bucket = grid.get(h);
    if (!bucket) {
      bucket = [];
      grid.set(h, bucket);
    }
    bucket.push(id);
  }

  const minDistSq = minDist * minDist;

  for (const idA of pieceStitchIds) {
    const ax = pos[idA * 3];
    const ay = pos[idA * 3 + 1];
    const az = pos[idA * 3 + 2];
    const cx = Math.floor(ax / cellSize);
    const cy = Math.floor(ay / cellSize);
    const cz = Math.floor(az / cellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(hashCell(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const idB of bucket) {
            if (idB <= idA + 1) continue; // Skip self and immediate working-yarn neighbor
            const vx = pos[idB * 3] - ax;
            const vy = pos[idB * 3 + 1] - ay;
            const vz = pos[idB * 3 + 2] - az;
            const dSq = vx * vx + vy * vy + vz * vz;
            if (dSq > 1e-6 && dSq < minDistSq) {
              const d = Math.sqrt(dSq);
              const overlap = (minDist - d) * 0.25;
              const nx = vx / d;
              const ny = vy / d;
              const nz = vz / d;
              const wA = pinned[idA] ? 0 : 0.5;
              const wB = pinned[idB] ? 0 : 0.5;
              const wSum = wA + wB;
              if (wSum > 0) {
                const sA = (wA / wSum) * overlap;
                const sB = (wB / wSum) * overlap;
                pos[idA * 3] -= nx * sA;
                pos[idA * 3 + 1] -= ny * sA;
                pos[idA * 3 + 2] -= nz * sA;
                pos[idB * 3] += nx * sB;
                pos[idB * 3 + 1] += ny * sB;
                pos[idB * 3 + 2] += nz * sB;
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Applies `@coil`, `@seam`, and `@attach` / `@glue` assembly transforms and constraints!
 */
function applyAssemblyTransforms(
  pattern: CompiledPattern,
  pos: Float32Array,
  pinned: Uint8Array
): DistanceConstraint[] {
  const extraConstraints: DistanceConstraint[] = [];
  const { pieces, stitches, rows, assemblies, stems } = pattern;
  const handledPieceOffsets = new Set<string>();

  // 1. Handle `@coil` first (e.g., rolling a flat scalloped crochet strip into a 3D Rose!)
  for (const asm of assemblies) {
    if (asm.kind !== 'coil') continue;
    const piece = pieces.find((p) => p.id === asm.pieceId);
    if (!piece || piece.stitchIds.length === 0) continue;
    handledPieceOffsets.add(piece.id);

    // Find X range of the flat strip before coiling
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const id of piece.stitchIds) {
      minX = Math.min(minX, pos[id * 3]);
      maxX = Math.max(maxX, pos[id * 3]);
      minY = Math.min(minY, pos[id * 3 + 1]);
    }
    const spanX = Math.max(1, maxX - minX);

    // Optional stem top anchor
    let stemOrigin: [number, number, number] = [0, 0, 0];
    if (asm.stemId) {
      const stem = stems.find((s) => s.id === asm.stemId);
      if (stem) {
        stemOrigin = evalPolyline(stem.points, 1.0).pos;
      }
    }

    // Map flat (x, y, z) -> cylindrical Archimedes spiral around stemOrigin!
    // Arc length s = x - minX; angle theta(s) grows smoothly as radius increases by pitch per turn!
    for (const id of piece.stitchIds) {
      const s = pos[id * 3] - minX;
      const localH = pos[id * 3 + 1] - minY;
      const localZ = pos[id * 3 + 2];

      // Convert arc-length s along spiral r(theta) = r0 + b*theta -> approximate theta
      const b = asm.pitch / (2 * Math.PI);
      const r0 = Math.max(0.25, asm.innerRadius);
      const theta =
        b > 1e-4
          ? (-r0 + Math.sqrt(r0 * r0 + 2 * b * s)) / b
          : s / r0;
      const rBase = r0 + b * theta;
      // Outer petals flare gently outward near their top edge (`localH`)!
      const petalFlare = localH * (0.12 + 0.32 * (s / spanX));
      const rFinal = rBase + petalFlare + localZ * 0.3;

      pos[id * 3] = stemOrigin[0] + Math.cos(theta) * rFinal;
      pos[id * 3 + 1] = stemOrigin[1] + localH * 0.92 - (s / spanX) * 0.45;
      pos[id * 3 + 2] = stemOrigin[2] + Math.sin(theta) * rFinal;
    }

    // Pin foundation spiral stitches so XPBD keeps the glued spiral base intact while petals relax!
    for (const eid of asm.edgeStitches) {
      pinned[eid] = 1;
    }
  }

  // 2. Apply default offsets/rotations to standalone pieces NOT governed by attach/glue/coil
  const attachedChildren = new Set(
    assemblies
      .filter((a): a is Extract<AssemblyConstraint, { kind: 'attach' | 'glue' }> =>
        a.kind === 'attach' || a.kind === 'glue'
      )
      .map((a) => a.childPiece)
  );

  for (const piece of pieces) {
    if (handledPieceOffsets.has(piece.id) || attachedChildren.has(piece.id)) continue;
    const [ox, oy, oz] = piece.defaultOffset;
    const [rx, ry, rz] = piece.defaultRotation;
    if (ox === 0 && oy === 0 && oz === 0 && rx === 0 && ry === 0 && rz === 0) continue;

    for (const id of piece.stitchIds) {
      const rot = rotateEuler([pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]], [rx, ry, rz]);
      pos[id * 3] = rot[0] + ox;
      pos[id * 3 + 1] = rot[1] + oy;
      pos[id * 3 + 2] = rot[2] + oz;
    }
    handledPieceOffsets.add(piece.id);
  }

  // 3. Handle `@attach` and `@glue` (onto host surface round/stitches OR onto a floral wire `@stem`!)
  for (const asm of assemblies) {
    if (asm.kind !== 'attach' && asm.kind !== 'glue') continue;
    const child = pieces.find((p) => p.id === asm.childPiece);
    if (!child || child.stitchIds.length === 0) continue;

    // Compute child base centroid (from `childStitches` or first stitch)
    const anchorIds = asm.childStitches.length > 0 ? asm.childStitches : [child.stitchIds[0]];
    let cbx = 0;
    let cby = 0;
    let cbz = 0;
    for (const cid of anchorIds) {
      cbx += pos[cid * 3];
      cby += pos[cid * 3 + 1];
      cbz += pos[cid * 3 + 2];
    }
    cbx /= anchorIds.length;
    cby /= anchorIds.length;
    cbz /= anchorIds.length;

    const hostTarget = asm.hostTarget;
    if (hostTarget.kind === 'stem') {
      const stem = stems.find((s) => s.id === hostTarget.stemId);
      if (!stem) continue;
      const { pos: stemPt } = evalPolyline(stem.points, hostTarget.t);
      const yaw = hostTarget.angleRad;
      const tilt = hostTarget.tiltRad ?? 0.5;

      for (const id of child.stitchIds) {
        const lx = pos[id * 3] - cbx;
        const ly = pos[id * 3 + 1] - cby;
        const lz = pos[id * 3 + 2] - cbz;
        const rotated = rotateEuler([lx, ly, lz], [tilt, yaw, 0]);
        pos[id * 3] = stemPt[0] + rotated[0];
        pos[id * 3 + 1] = stemPt[1] + rotated[1];
        pos[id * 3 + 2] = stemPt[2] + rotated[2];
      }
      for (const cid of anchorIds) pinned[cid] = 1;
    } else {
      // Surface attachment onto `hostPiece` at `(round, startStitch..endStitch)`!
      const targetSpec = hostTarget;
      const host = pieces.find((p) => p.id === targetSpec.hostPiece);
      if (!host || host.stitchIds.length === 0) continue;

      // Host centroid (to determine outward surface normal!)
      let hcx = 0;
      let hcy = 0;
      let hcz = 0;
      for (const hid of host.stitchIds) {
        hcx += pos[hid * 3];
        hcy += pos[hid * 3 + 1];
        hcz += pos[hid * 3 + 2];
      }
      hcx /= host.stitchIds.length;
      hcy /= host.stitchIds.length;
      hcz /= host.stitchIds.length;

      const hostRow =
        rows.find((r) => r.pieceId === host.id && r.rowNumber === targetSpec.round) ??
        rows.filter((r) => r.pieceId === host.id)[
          Math.min(
            Math.max(0, targetSpec.round - 1),
            rows.filter((r) => r.pieceId === host.id).length - 1
          )
        ];

      if (!hostRow) continue;
      const rowSts: number[] = [];
      for (let id = hostRow.firstStitchId; id <= hostRow.lastStitchId; id++) {
        if (stitches[id].pieceId === host.id && !stitches[id].isTurningChain) {
          rowSts.push(id);
        }
      }
      if (rowSts.length === 0) continue;

      const hostTargets: number[] = [];
      for (let k = targetSpec.startStitch; k <= targetSpec.endStitch; k++) {
        hostTargets.push(rowSts[((k % rowSts.length) + rowSts.length) % rowSts.length]);
      }

      let tx = 0;
      let ty = 0;
      let tz = 0;
      for (const hid of hostTargets) {
        tx += pos[hid * 3];
        ty += pos[hid * 3 + 1];
        tz += pos[hid * 3 + 2];
      }
      tx /= hostTargets.length;
      ty /= hostTargets.length;
      tz /= hostTargets.length;

      // Outward normal from host center through target patch
      let nx = tx - hcx;
      let ny = ty - hcy;
      let nz = tz - hcz;
      if (host.workMode === 'flat_rows') {
        nx = 0;
        ny = 0;
        nz = 1;
      }
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      // Determine child internal growth axis (from child base centroid to child overall centroid)
      let cgx = 0;
      let cgy = 0;
      let cgz = 0;
      for (const cid of child.stitchIds) {
        cgx += pos[cid * 3];
        cgy += pos[cid * 3 + 1];
        cgz += pos[cid * 3 + 2];
      }
      cgx = cgx / child.stitchIds.length - cbx;
      cgy = cgy / child.stitchIds.length - cby;
      cgz = cgz / child.stitchIds.length - cbz;
      const cgLen = Math.hypot(cgx, cgy, cgz);

      // Align child growth axis (+Y or +Z) with outward normal `(nx, ny, nz)` using Rodrigues' rotation!
      const srcAxis: [number, number, number] =
        cgLen > 0.25 ? [cgx / cgLen, cgy / cgLen, cgz / cgLen] : [0, 0, 1];
      const offsetDist = targetSpec.offsetNormal ?? 0.25;

      for (const id of child.stitchIds) {
        const lx = pos[id * 3] - cbx;
        const ly = pos[id * 3 + 1] - cby;
        const lz = pos[id * 3 + 2] - cbz;
        const aligned = rotateVectorAToB([lx, ly, lz], srcAxis, [nx, ny, nz]);
        pos[id * 3] = tx + nx * offsetDist + aligned[0];
        pos[id * 3 + 1] = ty + ny * offsetDist + aligned[1];
        pos[id * 3 + 2] = tz + nz * offsetDist + aligned[2];
      }

      // Add soft attachment springs between child anchor stitches and host target stitches!
      for (let m = 0; m < anchorIds.length; m++) {
        const hTarget = hostTargets[m % hostTargets.length];
        extraConstraints.push({
          a: anchorIds[m],
          b: hTarget,
          restLength: Math.max(0.2, Math.abs(offsetDist) + 0.25),
          compliance: 0.02,
          isPrimaryPost: false,
          enforceUpwardY: false,
        });
      }
    }
  }

  // 4. Handle `@seam` (zipping two stitch ranges together!)
  for (const asm of assemblies) {
    if (asm.kind !== 'seam') continue;
    const pA = pieces.find((p) => p.id === asm.pieceA);
    const pB = pieces.find((p) => p.id === asm.pieceB);
    if (!pA || !pB) continue;
    const count = Math.min(asm.stitchesA.length, asm.stitchesB.length);
    for (let k = 0; k < count; k++) {
      const idA = pA.stitchIds[asm.stitchesA[k]];
      const idB = pB.stitchIds[asm.stitchesB[k]];
      if (idA !== undefined && idB !== undefined) {
        extraConstraints.push({
          a: idA,
          b: idB,
          restLength: 0.35,
          compliance: 0.01,
          isPrimaryPost: false,
          enforceUpwardY: false,
        });
      }
    }
  }

  return extraConstraints;
}

function rotateVectorAToB(
  v: [number, number, number],
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number] {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (dot > 0.9995) return v;
  if (dot < -0.9995) {
    // 180-degree flip around an orthogonal axis
    const ortho: [number, number, number] =
      Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]];
    const oLen = Math.hypot(ortho[0], ortho[1], ortho[2]) || 1;
    const ux = ortho[0] / oLen;
    const uy = ortho[1] / oLen;
    const uz = ortho[2] / oLen;
    const uDotV = ux * v[0] + uy * v[1] + uz * v[2];
    return [2 * ux * uDotV - v[0], 2 * uy * uDotV - v[1], 2 * uz * uDotV - v[2]];
  }
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const cDotV = cx * v[0] + cy * v[1] + cz * v[2];
  const factor = 1 / (1 + dot);
  const kvx = cy * v[2] - cz * v[1];
  const kvy = cz * v[0] - cx * v[2];
  const kvz = cx * v[1] - cy * v[0];
  return [
    v[0] + kvx + cx * cDotV * factor - v[0] * (cx * cx + cy * cy + cz * cz) * factor,
    v[1] + kvy + cy * cDotV * factor - v[1] * (cx * cx + cy * cy + cz * cz) * factor,
    v[2] + kvz + cz * cDotV * factor - v[2] * (cx * cx + cy * cy + cz * cz) * factor,
  ];
}

export function solveStitchGeometry(
  pattern: CompiledPattern,
  options: SolveOptions = {}
): SolvedGeometry {
  const n = pattern.stitches.length;
  const positions = new Float32Array(n * 3);
  const tangents = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const stress = new Float32Array(n);
  stress.fill(1.0);

  if (n === 0) {
    return { positions, tangents, normals, stress };
  }

  const pinned = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (pattern.stitches[i].kind === 'magic_ring') {
      pinned[i] = 1;
    }
  }

  // Step 1: Constructive row-by-row geometric seeding
  seedInitialPositions(pattern, positions);

  // Step 2: Build base XPBD constraints & run local per-piece pre-relaxation
  const baseConstraints = buildDistanceConstraints(pattern);
  const iterations = options.iterations ?? 28;
  const dtSub = 1 / 60;

  for (let iter = 0; iter < Math.floor(iterations * 0.65); iter++) {
    projectDistanceConstraints(baseConstraints, positions, pinned, dtSub);

    // Optional gentle stuffing inflation for closed 3D amigurumi pieces
    for (const piece of pattern.pieces) {
      const isStuffed =
        options.stuffingOverride !== null && options.stuffingOverride !== undefined
          ? options.stuffingOverride && piece.workMode !== 'flat_rows'
          : piece.stuffed;
      if (isStuffed && piece.stitchIds.length >= 12) {
        applyGentleStuffingInflation(piece.stitchIds, positions, pinned, 0.012);
      }
      if (iter % 4 === 3) {
        applyShortRangeRepulsion(piece.stitchIds, positions, pinned, 0.68);
      }
    }
  }

  // Step 3: Apply multi-piece / `@coil` / `@glue` / `@attach` / `@seam` assembly transforms
  const assemblyConstraints = applyAssemblyTransforms(pattern, positions, pinned);
  const allConstraints =
    assemblyConstraints.length > 0
      ? [...baseConstraints, ...assemblyConstraints]
      : baseConstraints;

  const postIterations = Math.max(8, Math.ceil(iterations * 0.35));
  for (let iter = 0; iter < postIterations; iter++) {
    projectDistanceConstraints(allConstraints, positions, pinned, dtSub);
    if (iter % 4 === 3) {
      for (const piece of pattern.pieces) {
        applyShortRangeRepulsion(piece.stitchIds, positions, pinned, 0.65);
      }
    }
  }

  // Step 4: Compute orthonormal stitch frames (Tangents & Surface Normals) + Tension Stress
  computeFramesAndStress(pattern, allConstraints, positions, tangents, normals, stress);

  return { positions, tangents, normals, stress };
}

function projectDistanceConstraints(
  constraints: DistanceConstraint[],
  pos: Float32Array,
  pinned: Uint8Array,
  dt: number
): void {
  const dtSq = dt * dt;
  for (let i = 0; i < constraints.length; i++) {
    const c = constraints[i];
    const ia = c.a * 3;
    const ib = c.b * 3;
    const dx = pos[ib] - pos[ia];
    const dy = pos[ib + 1] - pos[ia + 1];
    const dz = pos[ib + 2] - pos[ia + 2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) continue;

    const wA = pinned[c.a] ? 0 : 1;
    const wB = pinned[c.b] ? 0 : 1;
    const wSum = wA + wB;
    if (wSum === 0) continue;

    const alpha = c.compliance / dtSq;
    const err = d - c.restLength;
    const lambda = -err / (wSum + alpha);
    const corr = lambda / d;

    if (wA > 0) {
      pos[ia] -= dx * corr * wA;
      pos[ia + 1] -= dy * corr * wA;
      pos[ia + 2] -= dz * corr * wA;
    }
    if (wB > 0) {
      pos[ib] += dx * corr * wB;
      pos[ib + 1] += dy * corr * wB;
      pos[ib + 2] += dz * corr * wB;
    }

    // Enforce upward vertical growth on primary post links so later rounds never invert below parent rounds!
    if (c.enforceUpwardY && pos[ib + 1] < pos[ia + 1] + 0.25) {
      const deficit = 0.28 - (pos[ib + 1] - pos[ia + 1]);
      if (deficit > 0) {
        if (wA > 0 && wB > 0) {
          pos[ia + 1] -= deficit * 0.35;
          pos[ib + 1] += deficit * 0.65;
        } else if (wB > 0) {
          pos[ib + 1] += deficit;
        }
      }
    }
  }
}

function applyGentleStuffingInflation(
  stitchIds: number[],
  pos: Float32Array,
  pinned: Uint8Array,
  strength: number
): void {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const id of stitchIds) {
    cx += pos[id * 3];
    cy += pos[id * 3 + 1];
    cz += pos[id * 3 + 2];
  }
  const inv = 1 / stitchIds.length;
  cx *= inv;
  cy *= inv;
  cz *= inv;

  for (const id of stitchIds) {
    if (pinned[id]) continue;
    const dx = pos[id * 3] - cx;
    const dy = pos[id * 3 + 1] - cy;
    const dz = pos[id * 3 + 2] - cz;
    const d = Math.hypot(dx, dy, dz) || 1;
    pos[id * 3] += (dx / d) * strength;
    pos[id * 3 + 1] += (dy / d) * strength * 0.55;
    pos[id * 3 + 2] += (dz / d) * strength;
  }
}

function computeFramesAndStress(
  pattern: CompiledPattern,
  constraints: DistanceConstraint[],
  pos: Float32Array,
  tangents: Float32Array,
  normals: Float32Array,
  stress: Float32Array
): void {
  const { stitches, pieces } = pattern;

  // Map piece centroids for fallback outward normal orientation on round pieces
  const pieceCenters = new Map<string, [number, number, number]>();
  for (const p of pieces) {
    if (p.stitchIds.length === 0) continue;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const id of p.stitchIds) {
      cx += pos[id * 3];
      cy += pos[id * 3 + 1];
      cz += pos[id * 3 + 2];
    }
    pieceCenters.set(p.id, [
      cx / p.stitchIds.length,
      cy / p.stitchIds.length,
      cz / p.stitchIds.length,
    ]);
  }

  for (let i = 0; i < stitches.length; i++) {
    const st = stitches[i];
    const ix = i * 3;

    // Working-yarn tangent T
    let tx = 1;
    let ty = 0;
    let tz = 0;
    const prevId = st.prevStitchId;
    const nextSt = stitches[i + 1]?.pieceId === st.pieceId ? stitches[i + 1] : null;

    if (prevId !== null && stitches[prevId]?.pieceId === st.pieceId && nextSt) {
      tx = pos[nextSt.id * 3] - pos[prevId * 3];
      ty = pos[nextSt.id * 3 + 1] - pos[prevId * 3 + 1];
      tz = pos[nextSt.id * 3 + 2] - pos[prevId * 3 + 2];
    } else if (prevId !== null && stitches[prevId]?.pieceId === st.pieceId) {
      tx = pos[ix] - pos[prevId * 3];
      ty = pos[ix + 1] - pos[prevId * 3 + 1];
      tz = pos[ix + 2] - pos[prevId * 3 + 2];
    } else if (nextSt) {
      tx = pos[nextSt.id * 3] - pos[ix];
      ty = pos[nextSt.id * 3 + 1] - pos[ix + 1];
      tz = pos[nextSt.id * 3 + 2] - pos[ix + 2];
    }
    const tLen = Math.hypot(tx, ty, tz) || 1;
    tx /= tLen;
    ty /= tLen;
    tz /= tLen;
    tangents[ix] = tx;
    tangents[ix + 1] = ty;
    tangents[ix + 2] = tz;

    // Growth vector B (from parent anchor -> stitch)
    let bx = 0;
    let by = 1;
    let bz = 0;
    if (st.anchors.length > 0) {
      const aid = st.anchors[0].targetStitchId;
      bx = pos[ix] - pos[aid * 3];
      by = pos[ix + 1] - pos[aid * 3 + 1];
      bz = pos[ix + 2] - pos[aid * 3 + 2];
      const bLen = Math.hypot(bx, by, bz);
      if (bLen > 1e-4) {
        bx /= bLen;
        by /= bLen;
        bz /= bLen;
      }
    }

    // Surface normal N = T x B (flipped on WS so Front Loop vs Back Loop matches the hook holder's view!)
    let nx = ty * bz - tz * by;
    let ny = tz * bx - tx * bz;
    let nz = tx * by - ty * bx;
    const nLen = Math.hypot(nx, ny, nz);

    if (nLen > 1e-4) {
      const sign = st.isRightSide ? 1 : -1;
      nx = (nx / nLen) * sign;
      ny = (ny / nLen) * sign;
      nz = (nz / nLen) * sign;
    } else {
      const pc = pieceCenters.get(st.pieceId) ?? [0, 0, 0];
      const rx = pos[ix] - pc[0];
      const rz = pos[ix + 2] - pc[2];
      const rLen = Math.hypot(rx, rz);
      if (rLen > 1e-3) {
        nx = rx / rLen;
        ny = 0;
        nz = rz / rLen;
      } else {
        nx = 0;
        ny = 0;
        nz = st.isRightSide ? 1 : -1;
      }
    }

    normals[ix] = nx;
    normals[ix + 1] = ny;
    normals[ix + 2] = nz;
  }

  // Stress ratio per stitch (max deviation across its connected edges)
  const counts = new Uint16Array(stitches.length);
  const accum = new Float32Array(stitches.length);
  for (const c of constraints) {
    const dx = pos[c.b * 3] - pos[c.a * 3];
    const dy = pos[c.b * 3 + 1] - pos[c.a * 3 + 1];
    const dz = pos[c.b * 3 + 2] - pos[c.a * 3 + 2];
    const actual = Math.hypot(dx, dy, dz);
    const ratio = actual / Math.max(0.15, c.restLength);
    accum[c.b] += ratio;
    counts[c.b]++;
  }
  for (let i = 0; i < stitches.length; i++) {
    if (counts[i] > 0) {
      stress[i] = accum[i] / counts[i];
    }
  }
}
