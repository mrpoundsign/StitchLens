import { FormEvent, KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { PatternBuffer } from '../utils/patternBuffers';
import { useLightDismissDialog } from './useLightDismissDialog';

interface BufferBarProps {
  buffers: PatternBuffer[];
  activeBufferId: string;
  activeTabId: string;
  onSelectBuffer: (id: string) => void;
  onCreateBuffer: () => void;
  onRenameBuffer: (id: string, nextName: string) => void;
  onDuplicateBuffer: (id: string) => void;
  onDeleteBuffer: (id: string) => void;
}

export function BufferBar({
  buffers,
  activeBufferId,
  activeTabId,
  onSelectBuffer,
  onCreateBuffer,
  onRenameBuffer,
  onDuplicateBuffer,
  onDeleteBuffer,
}: BufferBarProps) {
  const [focusedTabId, setFocusedTabId] = useState<string>(activeBufferId);
  const [renamingBufferId, setRenamingBufferId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string>('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const renameInputId = useId();
  const confirmTitleId = useId();
  const tablistRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const renameFormRef = useRef<HTMLFormElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const confirmModal = useLightDismissDialog();

  const activeBuffer = buffers.find((b) => b.id === activeBufferId) ?? buffers[0];
  const isSingleBuffer = buffers.length <= 1;
  const resolvedFocusedId = buffers.some((b) => b.id === focusedTabId)
    ? focusedTabId
    : activeBuffer.id;
  const pendingDeleteTarget = pendingDeleteId
    ? buffers.find((b) => b.id === pendingDeleteId) ?? null
    : null;

  useEffect(() => {
    setFocusedTabId(activeBufferId);
  }, [activeBufferId]);

  // Keep the selected tab visible inside the horizontal tab strip
  useEffect(() => {
    if (renamingBufferId !== null) return;
    const activeEl = tabRefs.current.get(activeBufferId);
    if (!activeEl) return;
    try {
      activeEl.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        container: 'nearest',
      } as ScrollIntoViewOptions);
    } catch {
      activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeBufferId, buffers.length, renamingBufferId]);

  // IntersectionObserver fallback for horizontal edge fades when scroll-driven animations are unsupported
  useEffect(() => {
    const scroller = tablistRef.current;
    if (!scroller || renamingBufferId !== null) return;
    if (typeof CSS !== 'undefined' && CSS.supports?.('animation-timeline', 'scroll()')) {
      return;
    }
    const first = scroller.firstElementChild;
    const last = scroller.lastElementChild;
    if (!first || !last || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === first) {
            scroller.classList.toggle('more-start', entry.intersectionRatio < 1);
          }
          if (entry.target === last) {
            scroller.classList.toggle('more-end', entry.intersectionRatio < 1);
          }
        }
      },
      { root: scroller, threshold: 1, rootMargin: '1px' }
    );

    observer.observe(first);
    observer.observe(last);
    return () => observer.disconnect();
  }, [buffers.length, renamingBufferId]);

  // Auto-focus and select inline rename input when opened
  useEffect(() => {
    if (renamingBufferId === null) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [renamingBufferId]);

  const startRename = (buf: PatternBuffer) => {
    setRenamingBufferId(buf.id);
    setDraftName(buf.name);
  };

  const commitRename = () => {
    if (renamingBufferId === null) return;
    const targetId = renamingBufferId;
    const nextName = draftName;
    setRenamingBufferId(null);
    onRenameBuffer(targetId, nextName);
  };

  const cancelRename = () => {
    setRenamingBufferId(null);
    setDraftName('');
  };

  const handleRenameSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    commitRename();
  };

  const requestDelete = (id: string) => {
    const target = buffers.find((b) => b.id === id);
    if (!target) return;
    if (target.patternText.trim().length === 0) {
      onDeleteBuffer(target.id);
      return;
    }
    setPendingDeleteId(target.id);
    confirmModal.openModal();
  };

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (buffers.length === 0) return;

    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % buffers.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + buffers.length) % buffers.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = buffers.length - 1;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onSelectBuffer(buffers[index].id);
      return;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      e.stopPropagation();
      const target = buffers[nextIndex];
      setFocusedTabId(target.id);
      tabRefs.current.get(target.id)?.focus();
    }
  };

  return (
    <>
      <div className="buffer-bar">
        {renamingBufferId !== null ? (
          <form
            ref={renameFormRef}
            className="buffer-rename-form"
            onSubmit={handleRenameSubmit}
          >
            <label htmlFor={renameInputId} className="visually-hidden">
              Buffer name
            </label>
            <input
              id={renameInputId}
              ref={renameInputRef}
              type="text"
              className="buffer-rename-input"
              maxLength={48}
              value={draftName}
              placeholder="Pattern buffer name"
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.nativeEvent.isComposing || e.keyCode === 229) {
                    return;
                  }
                  commitRename();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelRename();
                }
              }}
              onBlur={(e) => {
                const nextTarget = e.relatedTarget as Node | null;
                if (nextTarget && renameFormRef.current?.contains(nextTarget)) {
                  return;
                }
                commitRename();
              }}
            />
            <button type="submit" className="btn btn-primary buffer-action-btn">
              Save
            </button>
            <button
              type="button"
              className="btn buffer-action-btn"
              onClick={cancelRename}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <div
              ref={tablistRef}
              className="buffer-tablist"
              role="tablist"
              aria-label="Saved pattern buffers"
            >
              {buffers.map((buf, idx) => {
                const isActive = buf.id === activeBuffer.id;
                return (
                  <button
                    key={buf.id}
                    ref={(el) => {
                      if (el) {
                        tabRefs.current.set(buf.id, el);
                      } else {
                        tabRefs.current.delete(buf.id);
                      }
                    }}
                    type="button"
                    role="tab"
                    id={isActive ? activeTabId : undefined}
                    className="buffer-tab"
                    aria-selected={isActive}
                    tabIndex={resolvedFocusedId === buf.id ? 0 : -1}
                    title={`${buf.name} (${buf.dialect} terms) — double-click to rename`}
                    onClick={() => onSelectBuffer(buf.id)}
                    onDoubleClick={() => startRename(buf)}
                    onMouseDown={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                      }
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        requestDelete(buf.id);
                      }
                    }}
                    onKeyDown={(e) => handleTabKeyDown(e, idx)}
                  >
                    <span className="buffer-tab-label">{buf.name}</span>
                    {buf.dialect !== 'US' && (
                      <span className="buffer-tab-dialect">{buf.dialect}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="buffer-bar-actions">
              <button
                type="button"
                className="btn buffer-action-btn"
                onClick={onCreateBuffer}
                aria-label="New pattern buffer"
                title="New buffer"
              >
                +
              </button>
              <button
                type="button"
                className="btn buffer-action-btn"
                onClick={() => startRename(activeBuffer)}
                aria-label="Rename active buffer"
                title="Rename active buffer"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M11.5 2.5a1.75 1.75 0 0 1 2 2L5.25 12.75 2 13.5l.75-3.25Z" />
                </svg>
              </button>
              <button
                type="button"
                className="btn buffer-action-btn"
                onClick={() => onDuplicateBuffer(activeBuffer.id)}
                aria-label="Duplicate active buffer"
                title="Duplicate active buffer"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="5.5" y="5.5" width="8" height="8" rx="1.25" />
                  <path d="M10.5 5.5V3.75A1.25 1.25 0 0 0 9.25 2.5H3.75A1.25 1.25 0 0 0 2.5 3.75v5.5a1.25 1.25 0 0 0 1.25 1.25H5.5" />
                </svg>
              </button>
              <button
                type="button"
                className="btn buffer-action-btn buffer-action-btn-danger"
                onClick={() => requestDelete(activeBuffer.id)}
                aria-label={isSingleBuffer ? 'Clear active buffer' : 'Delete active buffer'}
                title={isSingleBuffer ? 'Clear active buffer' : 'Delete active buffer'}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>

      <dialog
        ref={confirmModal.dialogRef}
        className="modal-sheet modal-sheet-compact"
        aria-labelledby={confirmTitleId}
        onClose={() => setPendingDeleteId(null)}
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        <div className="dialog-header">
          <h2 id={confirmTitleId}>
            {isSingleBuffer
              ? `Clear "${pendingDeleteTarget?.name ?? 'buffer'}"?`
              : `Delete "${pendingDeleteTarget?.name ?? 'buffer'}"?`}
          </h2>
          <form method="dialog">
            <button type="submit" className="btn" aria-label="Cancel">
              &times;
            </button>
          </form>
        </div>
        <div className="dialog-body">
          <p className="buffer-confirm-copy">
            {isSingleBuffer
              ? 'This will clear the current pattern from browser storage. Save a .txt copy first if you want to keep it.'
              : 'This will permanently remove this pattern buffer from browser storage. Save a .txt copy first if you want to keep it.'}
          </p>
          <div className="dialog-actions">
            <form method="dialog">
              <button type="submit" className="btn" autoFocus>
                Cancel
              </button>
            </form>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (pendingDeleteTarget) {
                  onDeleteBuffer(pendingDeleteTarget.id);
                }
                confirmModal.closeModal();
              }}
            >
              {isSingleBuffer ? 'Clear Buffer' : 'Delete Buffer'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
