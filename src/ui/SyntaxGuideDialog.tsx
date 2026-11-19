import { RefObject, useId } from 'react';

interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>;
}

export function SyntaxGuideDialog({ dialogRef }: Props) {
  const titleId = useId();

  return (
    <dialog
      ref={dialogRef}
      className="modal-sheet"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="dialog-header">
        <h2 id={titleId}>Pattern Syntax &amp; Shorthand Guide</h2>
        <form method="dialog">
          <button type="submit" className="btn" autoFocus>
            Close
          </button>
        </form>
      </div>

      <div className="dialog-body" style={{ fontSize: '0.86rem' }}>
        <p style={{ marginBlockStart: 0 }}>
          <strong>StitchLens</strong> accepts both standard Craft Yarn Council patterns and casual
          Word/notebook shorthand—no programming required.
        </p>

        <h3>1. Rows, Rounds &amp; Multi-Piece Headers</h3>
        <ul>
          <li>
            <strong>Pieces:</strong> End a title line with a colon (e.g.{' '}
            <code>Shield [royal]:</code>, <code>Sword [silver]:</code>, <code>Head [tan]:</code>).
          </li>
          <li>
            <strong>Numbered Lines:</strong> <code>Rnd 1: ...</code>, <code>Row 2: ...</code>,{' '}
            <code>Rnds 5-8: 24 sc (24)</code>, or plain numbered lists like{' '}
            <code>3. Chain, turn, 2 inc (4)</code>.
          </li>
          <li>
            <strong>Smart Flat-Row Memory:</strong> Once a piece uses <code>turn</code>, later rows
            automatically remember to <code>ch 1, turn</code> even if you omit typing it!
          </li>
        </ul>

        <h3>2. Supported Stitches &amp; Shaping</h3>
        <ul>
          <li>
            <strong>Basic Stitches:</strong> <code>ch</code> (or <code>Chain</code>),{' '}
            <code>sl st</code>, <code>sc</code>, <code>hdc</code>, <code>dc</code>, <code>tr</code>,{' '}
            <code>V-st</code>, <code>picot</code>, <code>bobble</code>, <code>puff</code>,{' '}
            <code>popcorn</code>.
          </li>
          <li>
            <strong>Increases &amp; Decreases:</strong> <code>inc</code>, <code>2 inc</code>,{' '}
            <code>3 sc in same st</code>, <code>dec</code> / <code>invdec</code> /{' '}
            <code>sc2tog</code> / <code>dc2tog</code>.
          </li>
          <li>
            <strong>Loops &amp; Posts:</strong> <code>BLO</code> (back loop only), <code>FLO</code>{' '}
            (front loop only), <code>FPdc</code> / <code>BPdc</code> (front/back post),{' '}
            <code>in next ch-2 sp</code>, <code>working on opposite side of ch</code> (3D ovals).
          </li>
          <li>
            <strong>Borders:</strong>{' '}
            <code>CC: to grey, sc a border around and do 2 sc at the corners</code> walks all 4
            edges of a flat panel!
          </li>
        </ul>

        <h3>3. Comments &amp; Non-Instruction Notes</h3>
        <ul>
          <li>
            <strong>Ignored Comments:</strong> Start any line with <code>#</code> or{' '}
            <code>//</code> (e.g. <code># Hook: 4.0mm, worsted yarn</code>), or add an inline
            comment at the end of a row (<code>7. 10 sc (10) // straight sides</code>)—StitchLens
            ignores them completely.
          </li>
          <li>
            <strong>Timeline Craft Milestones:</strong> Start a line with <code>Note: ...</code>,{' '}
            <code>Tip: ...</code>, <code>Embroider...</code>, <code>Stuff...</code>, or{' '}
            <code>Fasten off</code> to display it as a helpful callout card in the 3D scrubber when
            you reach that step.
          </li>
        </ul>

        <h3>4. Colorwork, Assembly &amp; &ldquo;Glue&rdquo; Instructions</h3>
        <ul>
          <li>
            <strong>Color Changes:</strong> Whole-row <code>CC: to gold</code> or mid-round tapestry
            tags like <code>8 sc, [brown] 6 sc, [tan] 10 sc</code>.
          </li>
          <li>
            <strong>Plain-English Assembly &amp; 3D Click-to-Pin:</strong>
            <ul>
              <li>
                <code>Attach Left Ear to left of Head at Rnd 4</code> (supports{' '}
                <code>left</code>, <code>right</code>, <code>front</code>, <code>back</code>,{' '}
                <code>top-left</code>, <code>top-right</code>, or an exact{' '}
                <code>Stitch 6</code>)
              </li>
              <li>
                <strong>Interactive 3D Pinning:</strong> In any multi-piece pattern, use{' '}
                <strong>Pin in 3D</strong> in the viewport bar and click directly on any stitch in
                the 3D model to snap a piece there and auto-write the <code>Attach ...</code> line!
              </li>
              <li>
                <code>Roll Rose Strip into a flower on Stem</code> (rolls flat flower strips into 3D
                buds on a floral wire stem)
              </li>
              <li>
                <code>Glue Calyx under flower on Stem</code> /{' '}
                <code>Glue Leaf to middle of Stem</code>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </dialog>
  );
}
