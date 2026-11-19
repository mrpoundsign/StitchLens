import { describe, expect, it } from 'vitest';
import { compilePattern } from '../compiler/virtualHook';
import {
  detectPatternDialect,
  transcribePatternDialect,
} from '../parser/transcribeDialect';
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
    expect(errors[0].fixAction).toEqual({
      kind: 'update_declared_count',
      expectedCount: 15,
    });
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

  it('infers spiral_rounds (no implicit turns) for joined-leg / FLO-attached pieces without turns, and only flags true flat pieces', () => {
    const joinedAndFlatPattern = `
Body and Head:
11. Make 12 sc in each leg for a total of 24 sc (24)
12. 8 sc, FLO: (sc, inc) x 4, 8 sc (28)
13. 8 sc, (2 sc, inc) x 4, 8 sc (32)

Skirt:
1. 28 sc (28)
2. 28 sc (28)

Shield:
1. Ch 2
2. Increase in 2nd chain from hook (2)
3. Ch, turn, 2 inc (4)
7-10. 10 sc (10)
`;
    const compiled = compilePattern(joinedAndFlatPattern);
    const bodyPiece = compiled.pieces.find((p) => p.id === 'body_and_head')!;
    const skirtPiece = compiled.pieces.find((p) => p.id === 'skirt')!;
    const shieldPiece = compiled.pieces.find((p) => p.id === 'shield')!;

    expect(bodyPiece.workMode).toBe('spiral_rounds');
    expect(skirtPiece.workMode).toBe('spiral_rounds');
    expect(shieldPiece.workMode).toBe('flat_rows');

    const implicitRows = compiled.rows.filter((r) => r.implicitTurn);
    // Only Shield rows 7-10 should have implicit turns! Body and Skirt have 0 implicit turns.
    expect(implicitRows.every((r) => r.pieceId === 'shield')).toBe(true);
    expect(implicitRows.length).toBe(4);
  });

  it('seeds round-to-flat hybrid pieces (like a Hair cap with back-and-forth neck flap rows) as a compact 3D dome instead of a wide flat fan', () => {
    const hairAndEars = `
Hair:
Colour: Mustard
@stuffed false
1. 6 sc in a magic ring (6)
2. 6 inc (12)
3. (sc, inc) x 6 (18)
4. (2 sc, inc) x 6 (24)
5. (3 sc, inc) x 6 (30)
6. (4sc, inc) x 6 (36)
7-12. 36 sc (36)
13. 15 sc, ch, turn (15)
14. 15 sc, ch, turn (15)
15. 15 sc (15)

Ears (make 2):
Colour: Skin tone
@stuffed false
1. 6 sc in a magic ring (6)
2. 6 sc (6)
3. (2 sc, inc) x 2 (8)
`;
    const compiled = compilePattern(hairAndEars);
    const geom = solveStitchGeometry(compiled);
    const [hairPiece, earsPiece] = compiled.pieces;

    let hairMinX = Infinity;
    let hairMaxX = -Infinity;
    let hairMinZ = Infinity;
    let hairMaxZ = -Infinity;
    for (const id of hairPiece.stitchIds) {
      hairMinX = Math.min(hairMinX, geom.positions[id * 3]);
      hairMaxX = Math.max(hairMaxX, geom.positions[id * 3]);
      hairMinZ = Math.min(hairMinZ, geom.positions[id * 3 + 2]);
      hairMaxZ = Math.max(hairMaxZ, geom.positions[id * 3 + 2]);
    }
    // Hair cap (36 sc circumference) should have diameter ~11-13 units in both X and Z, NOT a 35-unit flat sheet!
    expect(hairMaxX - hairMinX).toBeLessThan(15);
    expect(hairMaxZ - hairMinZ).toBeGreaterThan(8);

    // And Hair's bounding box must not overlap Ears' bounding box in the kit grid
    let earsMinX = Infinity;
    for (const id of earsPiece.stitchIds) {
      earsMinX = Math.min(earsMinX, geom.positions[id * 3]);
    }
    expect(earsMinX).toBeGreaterThan(hairMaxX + 2);
  });

  it('transcribes pattern text between US, UK, and ES dialects while preserving comments, notes, and identical 3D stitch counts', () => {
    const usPattern = `
# Header comment with sc and dc that must not be touched
Shield [royal]:
1. 6 sc in a magic ring (6) // inline comment with sc
2. BLO 6 inc (12)
3. (sc, hdc, 2 dc, tr, dec) x 2, sl st, ch, turn (13)
Freeform note about the single crochet border
Fasten off
`;
    const usCompiled = compilePattern(usPattern, { dialect: 'US' });
    expect(usCompiled.diagnostics).toEqual([]);

    // 1. Transcribe US -> ES
    const toEs = transcribePatternDialect(usPattern, 'US', 'ES');
    expect(toEs.replacedCount).toBeGreaterThan(8);
    expect(toEs.text).toContain('# Header comment with sc and dc that must not be touched');
    expect(toEs.text).toContain('// inline comment with sc');
    expect(toEs.text).toContain('Freeform note about the single crochet border');
    expect(toEs.text).toContain('1. 6 pb en anillo mágico (6)');
    expect(toEs.text).toContain('2. PHT 6 aum (12)');
    expect(toEs.text).toContain('3. (pb, pma, 2 pa, pad, dism) x 2, pd, cad, girar (13)');
    expect(toEs.text).toContain('Cerrar');
    expect(detectPatternDialect(toEs.text)).toBe('ES');

    const esCompiled = compilePattern(toEs.text, { dialect: 'ES' });
    expect(esCompiled.diagnostics).toEqual([]);
    expect(esCompiled.stitches.length).toBe(usCompiled.stitches.length);

    // 2. Transcribe ES -> UK
    const toUk = transcribePatternDialect(toEs.text, 'ES', 'UK');
    expect(toUk.replacedCount).toBeGreaterThan(8);
    expect(toUk.text).toContain('1. 6 dc in a magic ring (6)');
    expect(toUk.text).toContain('2. BLO 6 inc (12)');
    expect(toUk.text).toContain('3. (dc, htr, 2 tr, dtr, dec) x 2, sl st, ch, turn (13)');
    expect(toUk.text).toContain('Fasten off');
    expect(detectPatternDialect(toUk.text)).toBe('UK');

    const ukCompiled = compilePattern(toUk.text, { dialect: 'UK' });
    expect(ukCompiled.diagnostics).toEqual([]);
    expect(ukCompiled.stitches.length).toBe(usCompiled.stitches.length);

    // 3. Transcribe UK -> US
    const backToUs = transcribePatternDialect(toUk.text, 'UK', 'US');
    expect(backToUs.text).toContain('1. 6 sc in a magic ring (6)');
    expect(backToUs.text).toContain('3. (sc, hdc, 2 dc, tr, dec) x 2, sl st, ch, turn (13)');
    expect(detectPatternDialect(backToUs.text)).toBe('US');
  });

  it('compiles circular ch-30 foundation with "1sc in each stitch around (30)", R2-R8 ranges, and keeps smaller decrease rings at the top (+Y)', () => {
    const testerSnippet1 = `
chain 30
Rnd 2 1sc in each stitch around (30)
Rnd 3: 1sc in each stitch around (30)
Rnd 4: 5sc, scdec x 10, 5sc (20)
Rnd 5: 6sc, scdec x4, 6sc (16)
Rnd 6: 6sc, scdec x2, 6sc (14)
`;
    const c1 = compilePattern(testerSnippet1);
    expect(c1.diagnostics).toEqual([]);
    expect(c1.rows.map((r) => r.emittedStitchCount)).toEqual([30, 30, 30, 20, 16, 14]);

    const g1 = solveStitchGeometry(c1);
    const meanYForRow = (rowNum: number) => {
      const sts = c1.stitches.filter((s) => s.rowNumber === rowNum);
      return sts.reduce((acc, s) => acc + g1.positions[s.id * 3 + 1], 0) / sts.length;
    };
    // Each round must climb strictly upward in Y so the smaller 14-stitch ring is at the TOP!
    expect(meanYForRow(2)).toBeGreaterThan(meanYForRow(1));
    expect(meanYForRow(3)).toBeGreaterThan(meanYForRow(2));
    expect(meanYForRow(4)).toBeGreaterThan(meanYForRow(3));
    expect(meanYForRow(5)).toBeGreaterThan(meanYForRow(4));
    expect(meanYForRow(6)).toBeGreaterThan(meanYForRow(5));

    // Also verify "rnd 1: ch 30" + "R2-R8 1sc in each (30)" syntax
    const testerSnippet2 = `
rnd 1: ch 30
R2-R8 1sc in each (30)
`;
    const c2 = compilePattern(testerSnippet2);
    expect(c2.diagnostics).toEqual([]);
    expect(c2.rows.length).toBe(8);
    expect(c2.rows.every((r) => r.emittedStitchCount === 30)).toBe(true);
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
