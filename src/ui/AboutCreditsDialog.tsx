import { RefObject, useId } from 'react';

interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>;
}

export function AboutCreditsDialog({ dialogRef }: Props) {
  const titleId = useId();

  return (
    <dialog
      ref={dialogRef}
      className="modal-sheet"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="dialog-header">
        <h2 id={titleId}>About StitchLens &amp; Credits</h2>
        <form method="dialog">
          <button type="submit" className="btn" autoFocus>
            Close
          </button>
        </form>
      </div>

      <div className="dialog-body" style={{ fontSize: '0.86rem' }}>
        <p style={{ marginBlockStart: 0 }}>
          <strong>StitchLens</strong> (<code>v0.0.4</code>) is an open-source, 100% client-side 3D
          crochet pattern visualizer, live scratchpad, and stitch-graph debugger. It compiles
          standard written crochet instructions (US, UK, and Spanish terms) into a topological
          stitch-attachment graph and relaxes it in 3D using Extended Position-Based Dynamics
          (XPBD).
        </p>

        <h3>1. Project &amp; License</h3>
        <ul>
          <li>
            <strong>Source Code &amp; Issue Tracker:</strong>{' '}
            <a
              href="https://github.com/mrpoundsign/StitchLens"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/mrpoundsign/StitchLens
            </a>{' '}
            &middot;{' '}
            <a
              href="https://github.com/mrpoundsign/StitchLens/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              Report an Issue
            </a>
          </li>
          <li>
            <strong>Application License:</strong>{' '}
            <a
              href="https://github.com/mrpoundsign/StitchLens/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
            >
              GNU Affero General Public License v3.0 (AGPL-3.0)
            </a>
          </li>
          <li>
            <strong>Bundled Starter Patterns:</strong> Dedicated to the public domain under{' '}
            <a
              href="https://creativecommons.org/publicdomain/zero/1.0/"
              target="_blank"
              rel="noopener noreferrer"
            >
              CC0 1.0 Universal
            </a>{' '}
            or adapted from pre-1930 Public Domain literature.
          </li>
        </ul>

        <h3>2. Crochet Standards &amp; Pattern Sources</h3>
        <ul>
          <li>
            <strong>Crochet Abbreviations &amp; Terminology:</strong>{' '}
            <a
              href="https://www.craftyarncouncil.com/standards/crochet-abbreviations"
              target="_blank"
              rel="noopener noreferrer"
            >
              Craft Yarn Council (CYC) — Master Crochet Abbreviations &amp; US/UK Standards
            </a>
          </li>
          <li>
            <strong>1918 Vintage Picot Star Medallion:</strong> Adapted from Jane Eayre
            Fryer&rsquo;s{' '}
            <a
              href="https://www.gutenberg.org/ebooks/25305"
              target="_blank"
              rel="noopener noreferrer"
            >
              <em>The Mary Frances Knitting and Crocheting Book</em> (1918, Project Gutenberg
              #25305, Public Domain)
            </a>
            .
          </li>
          <li>
            <strong>Hyperbolic Crochet Coral Ruffle:</strong> Inspired by{' '}
            <a
              href="https://pi.math.cornell.edu/~dtaimina/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Dr. Daina Taimi&#326;a&rsquo;s 1997 Hyperbolic Crochet Planes
            </a>{' '}
            and{' '}
            <a
              href="https://www.theiff.org/oexhibits/oe1e.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              The Institute For Figuring — Crochet Coral Reef Project
            </a>
            .
          </li>
        </ul>

        <h3>3. Research &amp; Algorithmic Inspiration</h3>
        <ul>
          <li>
            <strong>3D Crochet Graph Topology &amp; Seeding:</strong> Inspired by{' '}
            <a
              href="https://edryer.github.io/crochetparade/"
              target="_blank"
              rel="noopener noreferrer"
            >
              CrochetPARADE (Crochet Pattern Renderer, Analyzer and Debugger)
            </a>{' '}
            (<em>arXiv:2402.18604</em>) and{' '}
            <a
              href="https://textiles-lab.github.io/publications/2023-amigurumi/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Carnegie Mellon Textiles Lab / MIT CSAIL computational fiber research
            </a>
            .
          </li>
          <li>
            <strong>XPBD Physics Relaxation:</strong> Macklin, M., M&uuml;ller, M., &amp; Chentanez,
            N. (2016),{' '}
            <a
              href="https://matthias-research.github.io/pages/publications/XPBD.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              <em>XPBD: Position-Based Simulation of Compliant Constrained Dynamics</em>
            </a>
            .
          </li>
        </ul>

        <h3>4. Open-Source Libraries</h3>
        <ul>
          <li>
            <a href="https://threejs.org/" target="_blank" rel="noopener noreferrer">
              Three.js
            </a>{' '}
            (MIT License) — WebGL 3D yarn &amp; topological diagram rendering
          </li>
          <li>
            <a href="https://react.dev/" target="_blank" rel="noopener noreferrer">
              React
            </a>{' '}
            &amp;{' '}
            <a href="https://vite.dev/" target="_blank" rel="noopener noreferrer">
              Vite
            </a>{' '}
            (MIT License) — UI &amp; Web Worker build pipeline
          </li>
        </ul>
      </div>
    </dialog>
  );
}
