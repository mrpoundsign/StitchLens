# StitchLens — Interactive 3D Crochet Pattern Visualizer

**StitchLens** is a zero-install browser application (TypeScript + React + Three.js + Web Worker XPBD physics) that compiles written crochet instructions—both standard Craft Yarn Council patterns and live rough-draft notes—into an interactive **3D topological stitch graph**.

## Key Features

- **Live Crochet Scratchpad & Stitch-Count Verifier**:
  - Distraction-free editor (`spellcheck={false}`) with automatic per-row stitch counting and mismatch diagnostics.
  - Handles real-world shorthand: Word-style numbered lists (`3. Chain, turn, 2 inc (4)`), spaceless counts (`4sc`), row ranges (`Rnds 5-8: 24 sc`), omitted flat-row turns (`[auto turn]` inference + one-click fix), perimeter borders (`CC: to grey, sc a border around and do 2 sc at the corners`), and inline mid-round color changes (`8 sc, [brown] 6 sc, [tan] 10 sc`).
- **Dual 3D Render Modes**:
  - **Plush Yarn**: Procedural twisted-ply 3D V-loop caps and post legs anchored into exact parent loops.
  - **Diagram 3D**: Crisp topological stitch-graph showing separated Front Loop (`FLO`) and Back Loop (`BLO`) strands, post attachments, and working-yarn flow.
- **Step-by-Step Hook Scrubber**:
  - Scrub by stitch or row/round while a glowing target ring and 3D crochet hook tip highlight the exact loop(s) your hook enters next.
  - Includes **US ↔ UK Terminology**, **Right-Handed ↔ Left-Handed Mirroring**, **Tension Heatmap**, and zero-backend **Shareable URL Links** (`#z=...`).
- **11 CC0-1.0 & Pre-1930 Public Domain Starter Patterns**:
  - Covers flat swatches, pointed crest shields, magic-ring spheres, 3D ovals, `BLO` baskets with post-stitch ribbing, short-row bends, classic granny squares, hyperbolic coral ruffles, 3D coiled/glued roses on floral wire stems, multi-piece plushie heads with tapestry muzzles, and a 1918 vintage picot medallion.

## Local Development

```bash
npm install
npm run dev
```

## Quality Gate & Production Build

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## License

- **Application Source Code**: Licensed under the **GNU Affero General Public License v3.0 ([AGPL-3.0](LICENSE))**.
- **Bundled Starter Crochet Patterns**: Dedicated to the public domain under **[CC0-1.0](src/examples/LICENSE-PATTERNS.md)** and pre-1930 Public Domain.


Vite is configured with `base: './'`, so the app works automatically under any repository name or custom domain:
1. Push `main` to GitHub.
2. In **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**.
3. `.github/workflows/deploy.yml` runs typecheck, lint, tests, and publishes `./dist` automatically on every push to `main`.
