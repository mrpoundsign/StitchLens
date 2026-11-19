import { RefObject, useId, useState } from 'react';
import { EXAMPLE_PATTERNS, ExamplePattern } from '../examples/catalog';

interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>;
  activeExampleId: string;
  onSelectExample: (example: ExamplePattern) => void;
}

const CATEGORIES: Array<'All' | ExamplePattern['category']> = [
  'All',
  'Props & Plushies',
  'Foundations & Shaping',
  'Bouquets & Glue',
  'Motifs & Lace',
];

export function ExampleGalleryDialog({
  dialogRef,
  activeExampleId,
  onSelectExample,
}: Props) {
  const titleId = useId();
  const [selectedCategory, setSelectedCategory] =
    useState<(typeof CATEGORIES)[number]>('All');

  const filtered =
    selectedCategory === 'All'
      ? EXAMPLE_PATTERNS
      : EXAMPLE_PATTERNS.filter((e) => e.category === selectedCategory);

  return (
    <dialog
      ref={dialogRef}
      className="modal-sheet"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="dialog-header">
        <h2 id={titleId}>CC0 &amp; Public-Domain Example Patterns</h2>
        <form method="dialog">
          <button type="submit" className="btn" autoFocus>
            Close
          </button>
        </form>
      </div>

      <div className="dialog-body">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.4rem',
            marginBlockEnd: '1rem',
          }}
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`btn ${selectedCategory === cat ? 'btn-active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="example-grid">
          {filtered.map((ex) => {
            const isSelected = ex.id === activeExampleId;
            return (
              <article key={ex.id} className="example-card">
                <div>
                  <div className="example-meta" style={{ marginBlockEnd: '0.4rem' }}>
                    <span className="meta-pill">{ex.category}</span>
                    <span className="meta-pill">{ex.difficulty}</span>
                    <span className="meta-pill">{ex.license}</span>
                  </div>
                  <h3>{ex.title}</h3>
                  <p
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)',
                      marginBlock: '0.35rem',
                    }}
                  >
                    {ex.summary}
                  </p>
                  <p
                    style={{
                      fontSize: '0.75rem',
                      margin: 0,
                      color: 'var(--brand-accent)',
                    }}
                  >
                    <strong>Tip:</strong> {ex.whatToWatch}
                  </p>
                  {ex.sourceCredit && (
                    <p
                      style={{
                        fontSize: '0.73rem',
                        marginBlock: '0.35rem 0',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <strong>Source:</strong>{' '}
                      {ex.sourceUrl ? (
                        <a
                          href={ex.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--brand-mint)' }}
                        >
                          {ex.sourceCredit}
                        </a>
                      ) : (
                        ex.sourceCredit
                      )}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  className={`btn ${isSelected ? 'btn-active' : 'btn-primary'}`}
                  onClick={() => {
                    onSelectExample(ex);
                    dialogRef.current?.close();
                  }}
                >
                  {isSelected ? 'Currently Loaded' : 'Load in 3D Visualizer'}
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </dialog>
  );
}
