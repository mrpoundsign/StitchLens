import { CrochetDialect } from '../core/model/types';

export interface ExamplePattern {
  id: string;
  title: string;
  category: 'Props & Plushies' | 'Foundations & Shaping' | 'Motifs & Lace' | 'Bouquets & Glue';
  difficulty: 'Beginner' | 'Intermediate' | 'Designer';
  license: 'CC0-1.0' | 'Public Domain (1918)';
  dialect: CrochetDialect;
  summary: string;
  whatToWatch: string;
  sourceCredit?: string;
  sourceUrl?: string;
  patternText: string;
}

export const EXAMPLE_PATTERNS: ExamplePattern[] = [
  {
    id: 'shield_and_sword',
    title: 'Pointed Crest Shield & Mini Sword',
    category: 'Props & Plushies',
    difficulty: 'Intermediate',
    license: 'CC0-1.0',
    dialect: 'US',
    summary:
      'Live-drafted flat shield with omitted turns, mixed-height top crest, grey perimeter border, and a 3D magic-ring sword.',
    whatToWatch:
      'Scrub to Row 12 to watch taller center dc stitches arch the top crest, then step into the grey border to see corner 2-sc fans walk around the row ends!',
    patternText: `Shield [royal]:
1. Ch 2, sc in 2nd ch from hook (1)
2. Chain, turn, inc (2)
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

Sword [silver]:
@place 11 -1 0
1. 6 sc in a magic ring (6)
2. [sc, inc] x 3 (9)
3-8. 9 sc (9)
9. CC: to gold, FLO 9 hdc (9)
10. CC: to royal, BLO [sc, dec] x 3 (6)
11-13. 6 sc (6)
Glue or sew sword and shield props onto character`,
  },
  {
    id: 'capy_head_muzzle',
    title: 'Plushie Head + Tapestry Muzzle & Ears',
    category: 'Props & Plushies',
    difficulty: 'Designer',
    license: 'CC0-1.0',
    dialect: 'US',
    summary:
      '3D character head with inline mid-round color changes for a dark-brown snout patch plus two attached ears.',
    whatToWatch:
      'Watch how continuous spiral rounds naturally slant the dark-brown muzzle patch slightly—helping designers align colorwork before picking up yarn!',
    patternText: `Head [tan]:
Rnd 1: 6 sc in a magic ring (6)
Rnd 2: 6 inc (12)
Rnd 3: [sc, inc] x 6 (18)
Rnd 4: [2 sc, inc] x 6 (24)
Rnd 5: 8 sc, [brown] 5 sc, [tan] 11 sc (24)
Rnd 6: 8 sc, [brown] 6 sc, [tan] 10 sc (24)
Rnd 7: 9 sc, [brown] 6 sc, [tan] 9 sc (24)
Rnd 8: 9 sc, [brown] 5 sc, [tan] 10 sc (24)
Rnd 9: [2 sc, dec] x 6 (18)
Rnd 10: [sc, dec] x 6 (12)
Stuff firmly before closing
Rnd 11: 6 dec (6)

Left Ear [chestnut]:
Rnd 1: 6 sc in a magic ring (6)
Rnd 2: [sc, inc] x 3 (9)
Rnd 3: 9 sc (9)

Right Ear [chestnut]:
Rnd 1: 6 sc in a magic ring (6)
Rnd 2: [sc, inc] x 3 (9)
Rnd 3: 9 sc (9)

Attach Left Ear to left of Head at Rnd 4
Attach Right Ear to right of Head at Rnd 4`,
  },
  {
    id: 'amigurumi_sphere',
    title: 'Ideal 6-sc Amigurumi Sphere',
    category: 'Foundations & Shaping',
    difficulty: 'Beginner',
    license: 'CC0-1.0',
    dialect: 'US',
    summary:
      'The foundational building block of 3D plushies: magic ring start, proportional increases, straight equator, and invisible decreases.',
    whatToWatch:
      'Switch to Diagram 3D view and step across Rnd 2 (2 stitches fanning from each parent) vs Rnd 9 (1 stitch bridging 2 parents in a decrease).',
    patternText: `Sphere [sky]:
Rnd 1: 6 sc in a magic ring (6)
Rnd 2: 6 inc (12)
Rnd 3: [sc, inc] x 6 (18)
Rnd 4: [2 sc, inc] x 6 (24)
Rnds 5-7: 24 sc (24)
Rnd 8: [2 sc, dec] x 6 (18)
Rnd 9: [sc, dec] x 6 (12)
Stuff firmly
Rnd 10: 6 dec (6)
Fasten off`,
  },
  {
    id: 'oval_foot_base',
    title: '3D Oval Base (Both Sides of Chain)',
    category: 'Foundations & Shaping',
    difficulty: 'Beginner',
    license: 'CC0-1.0',
    dialect: 'US',
    summary:
      'One of the #1 beginner hurdles: crocheting down a chain, fanning 3 sc into the end chain, and pivoting onto the underside of the chain.',
    whatToWatch:
      'Step stitch-by-stitch through Rnd 1 as the glowing hook target rounds the tip of the foundation chain and works back along its underside!',
    patternText: `Oval Pod [mint]:
Foundation: ch 8
Rnd 1: sc in 2nd ch from hook, 5 sc, 3 sc in last ch, working on opposite side of ch: 5 sc, 2 sc in last ch (16)
Rnd 2: inc, 5 sc, 3 inc, 5 sc, 2 inc (22)
Rnd 3: BLO 22 sc (22)
Rnds 4-5: 22 sc (22)`,
  },
  {
    id: 'blo_ribbed_basket',
    title: 'BLO Structured Basket + Post Ribbing',
    category: 'Foundations & Shaping',
    difficulty: 'Intermediate',
    license: 'CC0-1.0',
    dialect: 'US',
    summary:
      'Demonstrates how a single Back-Loop-Only (BLO) round hinges a flat base 90 degrees upward into vertical walls, finished with FPdc/BPdc ribbing.',
    whatToWatch:
      'Inspect Rnd 5 in Diagram 3D mode to see the hook enter strictly the Back Loop (leaving the Front Loop ridge visible around the base!).',
    patternText: `Basket [oatmeal]:
@stuffed false
Rnd 1: 6 sc in a magic ring (6)
Rnd 2: 6 inc (12)
Rnd 3: [sc, inc] x 6 (18)
Rnd 4: [2 sc, inc] x 6 (24)
Rnd 5: CC: to caramel, BLO 24 sc (24)
Rnds 6-8: 24 hdc (24)
Rnd 9: CC: to cream, [FPdc, BPdc] x 12 (24)`,
  },
  {
    id: 'rolled_rose_bouquet',
    title: '3D Rolled Rose + Glued Stem & Leaf',
    category: 'Bouquets & Glue',
    difficulty: 'Intermediate',
    license: 'CC0-1.0',
    dialect: 'US',
    summary:
      'Shows why crochet flower patterns look strange on paper: a flat scalloped shell strip coils and hot-glues onto a wire stem!',
    whatToWatch:
      'Solo "Rose Strip" in the Piece Selector vs "All Pieces" to compare the scalloped strip against the coiled, stem-glued 3D flower.',
    patternText: `Rose Strip [rose]:
@stuffed false
Row 1: ch 28
Row 2: dc in 4th ch from hook, [ch 1, sk 1, V-st] x 11
Row 3: ch 1, turn, [5 dc in next ch-1 sp, sl st in next ch-1 sp] x 11

Calyx [forest]:
@stuffed false
Rnd 1: 5 sc in a magic ring (5)
Rnd 2: [sc, ch 3, sl st in same st] x 5

Leaf [emerald]:
@stuffed false
Row 1: ch 8, sc in 2nd ch from hook, hdc, 3 dc, hdc, sl st (7)

Roll Rose Strip into a flower on Stem
Glue Calyx under flower on Stem
Glue Leaf to middle of Stem`,
  },
  {
    id: 'granny_square',
    title: 'Classic Multi-Color Granny Square',
    category: 'Motifs & Lace',
    difficulty: 'Beginner',
    license: 'CC0-1.0',
    dialect: 'US',
    summary:
      'Traditional joined motif worked into ch-2 corner spaces and ch-1 side spaces with cheerful round-by-round color changes.',
    whatToWatch:
      'Watch how "(3 dc, ch 2, 3 dc) in next ch-2 sp" anchors 6 tall stitches right into each corner arch of the previous round.',
    patternText: `Granny Square [gold]:
@stuffed false
Foundation: ch 4, join with sl st to first ch to form a ring
Rnd 1: ch 3, 2 dc in ring, ch 2, [3 dc in ring, ch 2] x 3, join
Rnd 2: CC: to coral, ch 3, (2 dc, ch 2, 3 dc) in next ch-2 sp, ch 1, [(3 dc, ch 2, 3 dc) in next ch-2 sp, ch 1] x 3, join
Rnd 3: CC: to teal, ch 3, (2 dc, ch 2, 3 dc) in next ch-2 sp, ch 1, 3 dc in next ch-1 sp, ch 1, [(3 dc, ch 2, 3 dc) in next ch-2 sp, ch 1, 3 dc in next ch-1 sp, ch 1] x 3, join`,
  },
  {
    id: 'short_row_bend',
    title: 'Short-Row 3D Elbow / Snout Bend',
    category: 'Foundations & Shaping',
    difficulty: 'Intermediate',
    license: 'CC0-1.0',
    dialect: 'US',
    summary:
      'Demonstrates how turning mid-row ("short rows") inserts a wedge of extra fabric on one side to bend a panel or snout without seaming.',
    whatToWatch:
      'Step through Rows 4-7 to see the hook reverse direction halfway across, leaving unworked stitches waiting neatly until Row 8 sweeps across all 12!',
    patternText: `Short-Row Wedge [lavender]:
Row 1: ch 13, sc in 2nd ch from hook, 11 sc (12)
Row 2: ch 1, turn, 12 sc (12)
Row 3: ch 1, turn, 12 sc (12)
Row 4: CC: to violet, ch 1, turn, 8 sc (8)
Row 5: ch 1, turn, 6 sc (6)
Row 6: ch 1, turn, 6 sc (6)
Row 7: ch 1, turn, 8 sc (8)
Row 8: CC: to lavender, ch 1, turn, 12 sc (12)
Row 9: ch 1, turn, 12 sc (12)`,
  },
  {
    id: 'hyperbolic_coral',
    title: 'Hyperbolic Crochet Coral Ruffle',
    category: 'Foundations & Shaping',
    difficulty: 'Intermediate',
    license: 'CC0-1.0',
    dialect: 'US',
    summary:
      'Mathematical hyperbolic plane popularized in fiber geometry: increasing every 2nd stitch forces circumference to grow exponentially into 3D waves.',
    whatToWatch:
      'Rotate the 3D viewport to see how constant over-increasing naturally buckles into organic negative-curvature coral ruffles.',
    sourceCredit: 'Inspired by Dr. Daina Taimiņa (1997 Hyperbolic Crochet) & The Institute For Figuring',
    sourceUrl: 'https://www.theiff.org/oexhibits/oe1e.html',
    patternText: `Coral Reef [coral]:
@stuffed false
Rnd 1: 6 sc in a magic ring (6)
Rnd 2: 6 inc (12)
Rnd 3: [sc, inc] x 6 (18)
Rnd 4: [sc, inc] x 9 (27)
Rnd 5: [2 sc, inc] x 9 (36)
Rnd 6: CC: to peach, [sc, inc] x 18 (54)
Rnd 7: CC: to lemon, [2 sc, inc] x 18 (72)`,
  },
  {
    id: 'flat_swatch_sampler',
    title: 'Beginner Stitch-Height Swatch (sc / hdc / dc / tr)',
    category: 'Foundations & Shaping',
    difficulty: 'Beginner',
    license: 'CC0-1.0',
    dialect: 'US',
    summary:
      'Side-by-side height comparison of single, half-double, double, and treble crochet rows on a flat swatch.',
    whatToWatch:
      'Switch Color Mode to "Stitch Type" to compare post lengths of sc (1.0x), hdc (1.45x), dc (2.0x), and tr (2.65x).',
    patternText: `Height Sampler [sky]:
Row 1: ch 11, sc in 2nd ch from hook, 9 sc (10)
Row 2: ch 1, turn, 10 sc (10)
Row 3: ch 2, turn, 10 hdc (10)
Row 4: ch 3, turn, 10 dc (10)
Row 5: ch 4, turn, 10 tr (10)
Row 6: ch 1, turn, 10 sc (10)`,
  },
  {
    id: 'vintage_medallion_1918',
    title: '1918 Vintage Picot Star Medallion (Project Gutenberg)',
    category: 'Motifs & Lace',
    difficulty: 'Intermediate',
    license: 'Public Domain (1918)',
    dialect: 'US',
    summary:
      'Adapted from Jane Eayre Fryer\'s "The Mary Frances Knitting and Crocheting Book" (1918, Public Domain) featuring chain arches and picots.',
    whatToWatch:
      'Step through Rnd 3 to watch each ch-3 picot bud sit atop the lace shell arches.',
    sourceCredit: 'Jane Eayre Fryer, "The Mary Frances Knitting and Crocheting Book" (1918) — Project Gutenberg',
    sourceUrl: 'https://www.gutenberg.org/ebooks/25305',
    patternText: `# Source: Adapted from "The Mary Frances Knitting and Crocheting Book" (1918, Public Domain, https://www.gutenberg.org/ebooks/25305)
Vintage Medallion [ivory]:
@stuffed false
Foundation: ch 6, join with sl st to first ch to form a ring
Rnd 1: ch 1, 12 sc in ring, join (12)
Rnd 2: [ch 3, sk 1, sc] x 6, join
Rnd 3: [(2 dc, picot, 2 dc) in next ch-3 sp, sl st] x 6, join`,
  },
];
