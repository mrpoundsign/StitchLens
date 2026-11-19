import { describe, expect, it } from 'vitest';
import { compilePattern } from '../compiler/virtualHook';
import { solveStitchGeometry } from '../physics/solver';
import { EXAMPLE_PATTERNS } from '../../examples/catalog';
import { highlightPatternLine } from '../../ui/syntaxHighlight';

describe('StitchLens Core Compiler & XPBD 3D Geometry', () => {
  it('compiles the exact partial MS Word screenshot snippet (starting mid-pattern at Row 3!)', () => {
    const rawScreenshotText = `
3. Chain, turn, 2 inc (4)
4. Chain, turn, inc, 2 sc, inc (6)
5. Chain, turn, inc, 4sc, inc (8)
6. Chain, turn, inc, 6 sc, inc (10)
7. 10 sc (10)
8. 10 sc (10)
9. 10 sc (10)
10. 10 sc (10)
11. Dec, 6 sc, dec (8)
12. Sl st, sc, hdc, 2 dc, hdc, sc, sl st

CC: to grey, sc a border around and do 2 sc at the corners
Embroider the details of the shield onto the piece

Sword:
1. 6 sc in a magic ring
`;

    const compiled = compilePattern(rawScreenshotText);
    const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);

    // Two pieces: Main Piece (Shield) and Sword
    expect(compiled.pieces.length).toBe(2);
    expect(compiled.pieces[1].name).toBe('Sword');
    expect(compiled.pieces[1].workMode).toBe('spiral_rounds');

    // Check implicit turns were inferred on Rows 7-12
    const shieldRows = compiled.rows.filter((r) => r.pieceId === compiled.pieces[0].id);
    const row7 = shieldRows.find((r) => r.rowNumber === 7);
    const row12 = shieldRows.find((r) => r.rowNumber === 12);
    const borderRow = shieldRows.find((r) => r.isBorder);

    expect(row7?.implicitTurn).toBe(true);
    expect(row7?.emittedStitchCount).toBe(10);
    expect(row12?.implicitTurn).toBe(true);
    expect(row12?.emittedStitchCount).toBe(8);
    expect(borderRow).toBeDefined();
    expect(borderRow!.emittedStitchCount).toBeGreaterThan(20);

    // Check Embroidery milestone note captured cleanly
    expect(compiled.annotations.some((a) => a.kind === 'embroider')).toBe(true);

    // Verify 3D geometry solves without NaNs and Row 12 center dc arches higher than outer sl_st!
    const geom = solveStitchGeometry(compiled);
    for (let i = 0; i < geom.positions.length; i++) {
      expect(Number.isFinite(geom.positions[i])).toBe(true);
    }

    const row12Stitches = compiled.stitches.filter(
      (s) =>
        s.pieceId === compiled.pieces[0].id &&
        s.rowNumber === 12 &&
        !s.isTurningChain
    );
    expect(row12Stitches.length).toBe(8);
    const outerSlStY = geom.positions[row12Stitches[0].id * 3 + 1];
    const centerDcY = geom.positions[row12Stitches[3].id * 3 + 1];
    expect(centerDcY).toBeGreaterThan(outerSlStY + 0.8);
  });

  it('compiles and solves all 11 CC0 & Public-Domain starter patterns with zero errors or warnings', () => {
    for (const example of EXAMPLE_PATTERNS) {
      const compiled = compilePattern(example.patternText, { dialect: example.dialect });
      const issues = compiled.diagnostics.filter(
        (d) => d.severity === 'error' || d.severity === 'warning'
      );
      expect(issues, `Issues in ${example.id}: ${JSON.stringify(issues)}`).toEqual([]);
      expect(compiled.stitches.length).toBeGreaterThan(6);

      const geom = solveStitchGeometry(compiled);
      expect(geom.positions.length).toBe(compiled.stitches.length * 3);
      for (let i = 0; i < geom.positions.length; i++) {
        expect(Number.isFinite(geom.positions[i]), `Non-finite coord in ${example.id}`).toBe(true);
      }
    }
  });

  it('verifies geometric shape invariants (flat swatch planarity, 3D sphere volume, coiled rose compactness)', () => {
    // 1. Flat swatch should remain near-planar in Z AND rectangular (Row 1 centered straight under Row 6!)
    const swatchEx = EXAMPLE_PATTERNS.find((e) => e.id === 'flat_swatch_sampler')!;
    const swatchComp = compilePattern(swatchEx.patternText);
    const swatchGeom = solveStitchGeometry(swatchComp);
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < swatchComp.stitches.length; i++) {
      const z = swatchGeom.positions[i * 3 + 2];
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    expect(maxZ - minZ).toBeLessThan(0.8);

    const row1Sc = swatchComp.stitches.filter((s) => s.rowNumber === 1 && s.kind === 'sc');
    const row6Sc = swatchComp.stitches.filter((s) => s.rowNumber === 6 && s.kind === 'sc');
    const meanX1 =
      row1Sc.reduce((acc, s) => acc + swatchGeom.positions[s.id * 3], 0) / row1Sc.length;
    const meanX6 =
      row6Sc.reduce((acc, s) => acc + swatchGeom.positions[s.id * 3], 0) / row6Sc.length;
    expect(Math.abs(meanX1 - meanX6)).toBeLessThan(0.6);
    // And each stitch in Row 1 should align vertically with its foundation chain anchor (no diagonal crossing!)
    for (const st of row1Sc) {
      const ancId = st.anchors[0].targetStitchId;
      expect(
        Math.abs(swatchGeom.positions[st.id * 3] - swatchGeom.positions[ancId * 3])
      ).toBeLessThan(0.75);
    }

    // 2. Amigurumi sphere should have substantial 3D extent along X, Y, and Z
    const sphereEx = EXAMPLE_PATTERNS.find((e) => e.id === 'amigurumi_sphere')!;
    const sphereComp = compilePattern(sphereEx.patternText);
    const sphereGeom = solveStitchGeometry(sphereComp);
    const bounds = computeBounds(sphereGeom.positions);
    const spanX = bounds.max[0] - bounds.min[0];
    const spanY = bounds.max[1] - bounds.min[1];
    const spanZ = bounds.max[2] - bounds.min[2];
    expect(spanX).toBeGreaterThan(4);
    expect(spanY).toBeGreaterThan(4);
    expect(spanZ).toBeGreaterThan(4);

    // 3. Rolled Rose should coil its 28-chain strip into a compact 3D flower head
    const roseEx = EXAMPLE_PATTERNS.find((e) => e.id === 'rolled_rose_bouquet')!;
    const roseComp = compilePattern(roseEx.patternText);
    const roseGeom = solveStitchGeometry(roseComp);
    const stripPiece = roseComp.pieces.find((p) => p.id === 'rose_strip')!;
    let rMinX = Infinity;
    let rMaxX = -Infinity;
    for (const id of stripPiece.stitchIds) {
      rMinX = Math.min(rMinX, roseGeom.positions[id * 3]);
      rMaxX = Math.max(rMaxX, roseGeom.positions[id * 3]);
    }
    // Uncoiled 28-chain strip would span ~26 units in X; coiled rose head spans < 10 units!
    expect(rMaxX - rMinX).toBeLessThan(10);

    // 4. Vintage Medallion (1918) should lie flat in XZ plane, distribute Rnd 1 around the ch-6 ring,
    //    and anchor Rnd 3 valley slip stitches into Rnd 2's sc stitches (not Arch #1's chains!)
    const medEx = EXAMPLE_PATTERNS.find((e) => e.id === 'vintage_medallion_1918')!;
    const medComp = compilePattern(medEx.patternText);
    const medGeom = solveStitchGeometry(medComp);
    const medBounds = computeBounds(medGeom.positions);
    expect(medBounds.max[1] - medBounds.min[1]).toBeLessThan(1.5);

    const rnd1Sc = medComp.stitches.filter((s) => s.rowNumber === 1 && s.kind === 'sc');
    const uniqueRingAnchors = new Set(rnd1Sc.map((s) => s.anchors[0]?.targetStitchId));
    expect(uniqueRingAnchors.size).toBe(6);

    const rnd3ValleySlips = medComp.stitches.filter(
      (s) => s.rowNumber === 3 && s.kind === 'sl_st' && !s.isTurningChain
    );
    expect(rnd3ValleySlips.length).toBe(6);
    for (const sl of rnd3ValleySlips) {
      const parentSt = medComp.stitches[sl.anchors[0].targetStitchId];
      expect(parentSt.kind).toBe('sc');
    }

    // 5. Hyperbolic Coral Reef should have balanced wave amplitude across opposite sides of the circle
    const coralEx = EXAMPLE_PATTERNS.find((e) => e.id === 'hyperbolic_coral')!;
    const coralComp = compilePattern(coralEx.patternText);
    const coralGeom = solveStitchGeometry(coralComp);
    const outerRndSts = coralComp.stitches.filter((s) => s.rowNumber === 7);
    let posSideMaxY = -Infinity;
    let posSideMinY = Infinity;
    let negSideMaxY = -Infinity;
    let negSideMinY = Infinity;
    for (const st of outerRndSts) {
      const x = coralGeom.positions[st.id * 3];
      const y = coralGeom.positions[st.id * 3 + 1];
      if (x > 0) {
        posSideMaxY = Math.max(posSideMaxY, y);
        posSideMinY = Math.min(posSideMinY, y);
      } else {
        negSideMaxY = Math.max(negSideMaxY, y);
        negSideMinY = Math.min(negSideMinY, y);
      }
    }
    const posAmp = posSideMaxY - posSideMinY;
    const negAmp = negSideMaxY - negSideMinY;
    expect(posAmp).toBeGreaterThan(1.5);
    expect(negAmp).toBeGreaterThan(1.5);
    expect(Math.abs(posAmp - negAmp)).toBeLessThan(0.8);

    // 6. 3D Oval Pod should consume all foundation chains in Rnd 1 (none leaking into Rnd 2)
    //    and keep straight vertical walls from Rnd 3 to Rnd 5
    const ovalEx = EXAMPLE_PATTERNS.find((e) => e.id === 'oval_foot_base')!;
    const ovalComp = compilePattern(ovalEx.patternText);
    const ovalGeom = solveStitchGeometry(ovalComp);
    const rnd2Sts = ovalComp.stitches.filter((s) => s.rowNumber === 2 && !s.isTurningChain);
    for (const st of rnd2Sts) {
      const parentSt = ovalComp.stitches[st.anchors[0].targetStitchId];
      expect(parentSt.rowNumber).toBe(1);
    }
    const rnd4Sts = ovalComp.stitches.filter((s) => s.rowNumber === 4 && !s.isTurningChain);
    for (const st of rnd4Sts) {
      const ancId = st.anchors[0].targetStitchId;
      const dx = Math.abs(ovalGeom.positions[st.id * 3] - ovalGeom.positions[ancId * 3]);
      const dz = Math.abs(ovalGeom.positions[st.id * 3 + 2] - ovalGeom.positions[ancId * 3 + 2]);
      expect(Math.hypot(dx, dz)).toBeLessThan(0.6);
    }
  });

  it('parses natural-language English assembly & click-to-pin sentences', () => {
    const englishAssemblyPattern = `
Head [tan]:
Rnd 1: 6 sc in MR (6)
Rnd 2: 6 inc (12)
Rnd 3: [sc, inc] x 6 (18)

Left Ear [brown]:
Rnd 1: 6 sc in MR (6)

Right Ear [brown]:
Rnd 1: 6 sc in MR (6)

Attach Left Ear to left of Head at Rnd 3
Attach Right Ear to Head at Rnd 3, Stitch 4
`;
    const compiled = compilePattern(englishAssemblyPattern);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.assemblies.length).toBe(2);
    expect(compiled.assemblies[0].kind).toBe('attach');
    expect(compiled.assemblies[1].kind).toBe('attach');
  });

  it('flags stitch-count mismatches accurately when pattern math disagrees with (N)', () => {
    const broken = `
Rnd 1: 6 sc in MR (6)
Rnd 2: [sc, inc] x 5 (18)
`;
    const compiled = compilePattern(broken);
    const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBe(1);
    expect(errors[0].line).toBe(3);
    expect(errors[0].message).toContain('declares (18)');
    expect(errors[0].message).toContain('15');
  });

  it('supports UK crochet dialect translation (UK dc -> US sc, UK tr -> US dc)', () => {
    const ukPattern = `
Rnd 1: 6 dc in MR (6)
Rnd 2: 6 tr in each st around (6)
`;
    const compiled = compilePattern(ukPattern, { dialect: 'UK' });
    const nonRing = compiled.stitches.filter((s) => s.kind !== 'magic_ring');
    expect(nonRing.slice(0, 6).every((s) => s.kind === 'sc')).toBe(true);
    expect(nonRing.slice(6, 12).every((s) => s.kind === 'dc')).toBe(true);
  });

  it('supports Spanish (ES) crochet dialect terms (pb, pa, pma, aum, dism, am)', () => {
    const esPattern = `
Cabeza:
1. 6 pb en am (6)
2. 6 aum (12)
3. (pb, aum) x 6 (18)
4. (pb, dism) x 6 (12)
`;
    const compiled = compilePattern(esPattern, { dialect: 'ES' });
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.pieces.length).toBe(1);
    expect(compiled.pieces[0].stitchIds.length).toBe(1 + 6 + 12 + 18 + 12);
  });

  it('treats any line with an unrecognized beginning as a freeform comment/note with 0 warnings', () => {
    const freeformPattern = `
Legs (make 2):
Colour: Golden Brown
This is a completely freeform note without # or // or Note: prefix!
1. Chain 7
2. Starting in 2nd chain from hook: inc, 4sc, inc x 2, 4sc, inc (16)
For the second leg, make 2 more sc and join to the first leg at stitch 10.
Remember to hide the yarn tail inside the piece when done.
`;
    const compiled = compilePattern(freeformPattern);
    const warningsOrErrors = compiled.diagnostics.filter(
      (d) => d.severity === 'error' || d.severity === 'warning'
    );
    expect(warningsOrErrors).toEqual([]);
    expect(compiled.pieces.length).toBe(1);
    expect(compiled.pieces[0].stitchIds.length).toBe(7 + 16);
    expect(compiled.annotations.length).toBe(3);
    expect(compiled.annotations.every((a) => a.kind === 'note')).toBe(true);
  });

  it('partitions per-piece stitch ID ranges and syntax-highlights pattern lines', () => {
    const multiPiece = `
First Part:
1. 6 sc in a magic ring (6)
2. 6 inc (12)

Second Part:
1. 5 sc in a magic ring (5)
Freeform reminder at the end
`;
    const compiled = compilePattern(multiPiece);
    expect(compiled.pieces.length).toBe(2);
    const [p1, p2] = compiled.pieces;
    expect(p1.stitchIds.length).toBe(1 + 6 + 12);
    expect(p2.stitchIds.length).toBe(1 + 5);
    expect(p1.stitchIds[0]).toBe(0);
    expect(p1.stitchIds[p1.stitchIds.length - 1]).toBe(18);
    expect(p2.stitchIds[0]).toBe(19);
    expect(p2.stitchIds[p2.stitchIds.length - 1]).toBe(24);

    // Syntax highlighter classifies piece headers, numbered rows, and freeform comment lines
    const headerNode = highlightPatternLine('First Part:', 0);
    const rowNode = highlightPatternLine('1. 6 sc in a magic ring (6)', 1);
    const freeformNode = highlightPatternLine('Freeform reminder at the end', 5);
    expect(headerNode).toBeTruthy();
    expect(rowNode).toBeTruthy();
    expect(freeformNode).toBeTruthy();
  });
});

function computeBounds(pos: Float32Array): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    min[0] = Math.min(min[0], pos[i]);
    min[1] = Math.min(min[1], pos[i + 1]);
    min[2] = Math.min(min[2], pos[i + 2]);
    max[0] = Math.max(max[0], pos[i]);
    max[1] = Math.max(max[1], pos[i + 1]);
    max[2] = Math.max(max[2], pos[i + 2]);
  }
  return { min, max };
}
