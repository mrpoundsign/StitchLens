import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { compilePattern } from '../core/compiler/virtualHook';
import {
  AttachmentSite,
  CompiledPattern,
  CrochetDialect,
  SolvedGeometry,
} from '../core/model/types';
import { solveStitchGeometry } from '../core/physics/solver';
import { EXAMPLE_PATTERNS, ExamplePattern } from '../examples/catalog';
import {
  ColorSchemeMode,
  CrochetViewport,
  RenderViewMode,
  STITCH_TYPE_COLORS,
} from '../renderer/CrochetViewport';
import { decodeShareHash, encodeShareHash } from '../utils/shareCodec';
import type { SimWorkerRequest, SimWorkerResponse } from '../workers/sim.worker';
import { ExampleGalleryDialog } from './ExampleGalleryDialog';
import { SyntaxGuideDialog } from './SyntaxGuideDialog';
import { useLightDismissDialog } from './useLightDismissDialog';

const SITE_LABELS: Record<AttachmentSite, string> = {
  both_loops: 'both top loops',
  flo: 'Front Loop Only (FLO)',
  blo: 'Back Loop Only (BLO)',
  front_post: 'Front Post (around stitch stem)',
  back_post: 'Back Post (around stitch stem)',
  chain_space: 'chain-space arch',
  chain_underside: 'underside of foundation chain',
  row_end_post: 'side row-end edge',
  ring_center: 'center of Magic Ring',
};

function detectDarkTheme(): boolean {
  if (typeof document === 'undefined') return true;
  const meta = document.querySelector('meta[name="color-scheme"]')?.getAttribute('content');
  if (meta === 'dark') return true;
  if (meta === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

export function App() {
  const defaultExample = EXAMPLE_PATTERNS[0];
  const [activeExampleId, setActiveExampleId] = useState<string>(defaultExample.id);
  const [patternText, setPatternText] = useState<string>(defaultExample.patternText);
  const [dialect, setDialect] = useState<CrochetDialect>(defaultExample.dialect);

  const [viewMode, setViewMode] = useState<RenderViewMode>('yarn');
  const [colorMode, setColorMode] = useState<ColorSchemeMode>('yarn');
  const [leftHanded, setLeftHanded] = useState<boolean>(false);
  const [showGhostFuture, setShowGhostFuture] = useState<boolean>(true);
  const [autoFollowHook, setAutoFollowHook] = useState<boolean>(false);
  const [stuffingOverride, setStuffingOverride] = useState<boolean | null>(null);
  const [soloPieceId, setSoloPieceId] = useState<string | null>(null);

  const [currentStep, setCurrentStep] = useState<number>(999999);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<'both' | 'viewport'>('both');
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(detectDarkTheme);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [editorWidth, setEditorWidth] = useState<number>(420);
  const [outlineHeight, setOutlineHeight] = useState<number>(210);
  const [draggingAxis, setDraggingAxis] = useState<'col' | 'row' | null>(null);
  const [pinningPieceId, setPinningPieceId] = useState<string | null>(null);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);

  const sliderId = useId();
  const dialectSelectId = useId();
  const colorModeSelectId = useId();
  const pinPieceSelectId = useId();

  const galleryModal = useLightDismissDialog();
  const guideModal = useLightDismissDialog();

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const editorPaneRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<CrochetViewport | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const reqCounterRef = useRef<number>(0);
  const needsCameraFitRef = useRef<boolean>(true);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2800);
  }, []);

  // Load `?example=<id>` query parameter or compressed `#z=...` share state on startup
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedExId = params.get('example');
    if (requestedExId) {
      const found = EXAMPLE_PATTERNS.find((e) => e.id === requestedExId);
      if (found) {
        needsCameraFitRef.current = true;
        setActiveExampleId(found.id);
        setDialect(found.dialect);
        setPatternText(found.patternText);
      }
    }

    if (window.location.hash.length > 3) {
      void decodeShareHash(window.location.hash).then((decoded) => {
        if (!decoded || !decoded.p) return;
        needsCameraFitRef.current = true;
        setActiveExampleId('custom');
        setPatternText(decoded.p);
        if (decoded.d) setDialect(decoded.d);
        if (decoded.m) setViewMode(decoded.m);
        if (decoded.h === 'L') setLeftHanded(true);
        if (typeof decoded.s === 'number') {
          setCurrentStep(decoded.s);
        }
      });
    }
  }, []);

  // Listen to OS color-scheme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setIsDarkTheme(detectDarkTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Compile pattern synchronously on edit (sub-millisecond!)
  const compiled: CompiledPattern = useMemo(
    () => compilePattern(patternText, { dialect }),
    [patternText, dialect]
  );

  const onStitchClickRef = useRef<(clickedStitchId: number) => void>(() => {});
  useEffect(() => {
    onStitchClickRef.current = (clickedStitchId: number) => {
      if (pinningPieceId) {
        const clickedSt = compiled.stitches[clickedStitchId];
        const childPiece = compiled.pieces.find((p) => p.id === pinningPieceId);
        const hostPiece = compiled.pieces.find((p) => p.id === clickedSt?.pieceId);
        if (clickedSt && childPiece && hostPiece && childPiece.id !== hostPiece.id) {
          const stNum = clickedSt.indexInRow + 1;
          const newSentence = `Attach ${childPiece.name} to ${hostPiece.name} at Rnd ${clickedSt.rowNumber}, Stitch ${stNum}`;
          const escapedChild = childPiece.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const existingRegex = new RegExp(
            `^(?:(?:attach|glue|pin|sew)\\s+${escapedChild}\\s+to\\b.*|@(?:attach|glue)\\s+${childPiece.id}\\b.*)$`,
            'im'
          );

          setPatternText((prev) => {
            if (existingRegex.test(prev)) {
              return prev.replace(existingRegex, newSentence);
            }
            return `${prev.trimEnd()}\n\n${newSentence}`;
          });
          setPinningPieceId(null);
          showToast(
            `Pinned ${childPiece.name} to ${hostPiece.name} (Rnd ${clickedSt.rowNumber}, Stitch ${stNum})!`
          );
          return;
        }
      }
      setIsPlaying(false);
      setCurrentStep(clickedStitchId);
    };
  }, [compiled, pinningPieceId, showToast]);

  const totalStitches = compiled.stitches.length;
  const clampedStep = Math.max(0, Math.min(Math.max(0, totalStitches - 1), currentStep));

  // Sync CSS custom properties on `<input type="range">` for cross-browser filled-track progress
  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return;
    const maxVal = Math.max(0, totalStitches - 1);
    slider.style.setProperty('--attr-min', '0');
    slider.style.setProperty('--attr-max', String(Math.max(1, maxVal)));
    slider.style.setProperty('--control-value', String(clampedStep));
  }, [clampedStep, totalStitches]);

  // Initialize Three.js Viewport once
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const vp = new CrochetViewport(
      host,
      {
        viewMode,
        colorMode,
        currentStep: clampedStep,
        showGhostFuture,
        leftHanded,
        soloPieceId,
        autoFollowHook,
        isDarkTheme,
      },
      (clickedStitchId) => {
        onStitchClickRef.current(clickedStitchId);
      }
    );
    viewportRef.current = vp;

    return () => {
      vp.dispose();
      viewportRef.current = null;
    };
  }, []);

  // Initialize Web Worker for 3D XPBD physics relaxation (with main-thread fallback)
  const [geometry, setGeometry] = useState<SolvedGeometry>(() =>
    solveStitchGeometry(compiled, { iterations: 28, stuffingOverride })
  );

  useEffect(() => {
    try {
      const worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent<SimWorkerResponse>) => {
        if (e.data.requestId === reqCounterRef.current) {
          setGeometry(e.data.geometry);
        }
      };
      return () => {
        worker.terminate();
        workerRef.current = null;
      };
    } catch {
      workerRef.current = null;
    }
  }, []);

  // Re-solve 3D geometry whenever compiled graph or stuffing setting changes
  useEffect(() => {
    const reqId = ++reqCounterRef.current;
    if (workerRef.current) {
      const payload: SimWorkerRequest = {
        requestId: reqId,
        pattern: compiled,
        stuffingOverride,
      };
      workerRef.current.postMessage(payload);
    } else {
      setGeometry(solveStitchGeometry(compiled, { iterations: 28, stuffingOverride }));
    }
  }, [compiled, stuffingOverride]);

  // Push new pattern + geometry into Three.js Viewport
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || geometry.positions.length !== compiled.stitches.length * 3) return;
    const shouldFit = needsCameraFitRef.current;
    needsCameraFitRef.current = false;
    vp.setData(
      compiled,
      geometry,
      {
        viewMode,
        colorMode,
        currentStep: clampedStep,
        showGhostFuture,
        leftHanded,
        soloPieceId,
        autoFollowHook,
        isDarkTheme,
      },
      shouldFit
    );
  }, [compiled, geometry]);

  // Push lightweight scrubber/toggle updates into Three.js Viewport
  useEffect(() => {
    viewportRef.current?.updateSettings({
      viewMode,
      colorMode,
      currentStep: clampedStep,
      showGhostFuture,
      leftHanded,
      soloPieceId,
      autoFollowHook,
      isDarkTheme,
    });
  }, [
    viewMode,
    colorMode,
    clampedStep,
    showGhostFuture,
    leftHanded,
    soloPieceId,
    autoFollowHook,
    isDarkTheme,
  ]);

  // Step-by-step Play timer
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setCurrentStep((prev) => {
        const cur = Math.min(prev, totalStitches - 1);
        if (cur >= totalStitches - 1) {
          setIsPlaying(false);
          return Math.max(0, totalStitches - 1);
        }
        return cur + 1;
      });
    }, 110);
    return () => window.clearInterval(timer);
  }, [isPlaying, totalStitches]);

  // Global keyboard arrow shortcuts when focus isn't inside the pattern textarea
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        setCurrentStep((s) => Math.min(totalStitches - 1, Math.min(s, totalStitches - 1) + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        setCurrentStep((s) => Math.max(0, Math.min(s, totalStitches - 1) - 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying((p) => {
          if (!p && clampedStep >= totalStitches - 1) {
            setCurrentStep(0);
          }
          return !p;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clampedStep, totalStitches]);

  const activeStitch = compiled.stitches[clampedStep] ?? null;
  const activePiece = useMemo(
    () => compiled.pieces.find((p) => p.id === activeStitch?.pieceId) ?? null,
    [compiled.pieces, activeStitch]
  );
  const activeRow = useMemo(
    () =>
      compiled.rows.find(
        (r) =>
          activeStitch &&
          activeStitch.id >= r.firstStitchId &&
          activeStitch.id <= r.lastStitchId
      ) ?? null,
    [compiled.rows, activeStitch]
  );

  const activeMilestone = useMemo(() => {
    if (!activeStitch) return null;
    return (
      compiled.annotations.find(
        (a) =>
          a.pieceId === activeStitch.pieceId &&
          Math.abs(a.afterStitchId - activeStitch.id) <= 1
      ) ?? null
    );
  }, [compiled.annotations, activeStitch]);

  const stepByRow = (delta: -1 | 1) => {
    setIsPlaying(false);
    if (compiled.rows.length === 0) return;
    const curRowIdx = compiled.rows.findIndex(
      (r) => clampedStep >= r.firstStitchId && clampedStep <= r.lastStitchId
    );
    const nextIdx = Math.max(
      0,
      Math.min(compiled.rows.length - 1, (curRowIdx >= 0 ? curRowIdx : 0) + delta)
    );
    setCurrentStep(compiled.rows[nextIdx].lastStitchId);
  };

  const handleSelectExample = (ex: ExamplePattern) => {
    setIsPlaying(false);
    needsCameraFitRef.current = true;
    setSoloPieceId(null);
    setPinningPieceId(null);
    setLoadedFileName(null);
    setActiveExampleId(ex.id);
    setDialect(ex.dialect);
    setPatternText(ex.patternText);
    setCurrentStep(999999);
    if (window.location.hash || window.location.search) {
      history.replaceState(null, '', window.location.pathname);
    }
  };

  const loadTxtFile = async (file: File) => {
    try {
      const text = await file.text();
      setIsPlaying(false);
      needsCameraFitRef.current = true;
      setSoloPieceId(null);
      setPinningPieceId(null);
      setActiveExampleId('custom');
      setLoadedFileName(file.name);
      setPatternText(text);
      setCurrentStep(999999);
      showToast(`Loaded "${file.name}"`);
    } catch {
      showToast('Could not read that .txt file.');
    }
  };

  const handleSaveTxtFile = () => {
    let baseName = loadedFileName;
    if (!baseName) {
      const ex = EXAMPLE_PATTERNS.find((e) => e.id === activeExampleId);
      const rawTitle = ex?.title ?? compiled.pieces[0]?.name ?? 'crochet-pattern';
      const slug =
        rawTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'crochet-pattern';
      baseName = `${slug}.txt`;
    } else if (!baseName.toLowerCase().endsWith('.txt')) {
      baseName = `${baseName}.txt`;
    }

    const blob = new Blob([patternText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = baseName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Saved "${baseName}"`);
  };

  // Two-state comfort theme toggle per modern-web-guidance (`dark-mode-toggle`)
  const handleToggleTheme = () => {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (!meta) return;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const targetDark = !isDarkTheme;
    if (targetDark === systemDark) {
      try {
        localStorage.removeItem('color-scheme');
      } catch {
        // Ignore storage block
      }
      meta.setAttribute('content', 'light dark');
    } else {
      const literal = targetDark ? 'dark' : 'light';
      try {
        localStorage.setItem('color-scheme', literal);
      } catch {
        // Ignore storage block
      }
      meta.setAttribute('content', literal);
    }
    setIsDarkTheme(targetDark);
  };

  const handleShareLink = async () => {
    const hash = await encodeShareHash({
      p: patternText,
      s: clampedStep < totalStitches - 1 ? clampedStep : undefined,
      d: dialect !== 'US' ? dialect : undefined,
      m: viewMode !== 'yarn' ? viewMode : undefined,
      h: leftHanded ? 'L' : undefined,
    });
    const fullUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
    history.replaceState(null, '', hash);
    try {
      await navigator.clipboard.writeText(fullUrl);
      showToast('Shareable 3D pattern link copied to clipboard!');
    } catch {
      showToast('URL updated in address bar — copy it to share!');
    }
  };

  // Helper for live pattern authors: inserts explicit "Chain, turn, " on rows that relied on implicit turns!
  const implicitTurnRows = useMemo(
    () => compiled.rows.filter((r) => r.implicitTurn),
    [compiled.rows]
  );

  const handleInsertExplicitTurns = () => {
    const targetLines = new Set(implicitTurnRows.map((r) => r.sourceLine));
    const updated = patternText
      .split('\n')
      .map((line, idx) => {
        if (!targetLines.has(idx + 1)) return line;
        return line.replace(
          /^(\s*(?:(?:rows?|r)\s*\d+\s*[:.-]|\d+\s*[.):-])\s*)/i,
          '$1Chain, turn, '
        );
      })
      .join('\n');
    setPatternText(updated);
    showToast(`Added explicit "Chain, turn," to ${targetLines.size} flat row(s)!`);
  };

  const jumpEditorToLine = (lineNum: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const lines = patternText.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(lineNum - 1, lines.length); i++) {
      offset += lines[i].length + 1;
    }
    const lineLen = lines[lineNum - 1]?.length ?? 0;
    ta.focus();
    ta.setSelectionRange(offset, offset + lineLen);
  };

  const sliderAriaText = activeStitch
    ? `Stitch ${clampedStep + 1} of ${totalStitches}: ${activePiece?.name ?? 'Piece'}, ${activeRow?.label ?? `Row ${activeStitch.rowNumber}`}, ${activeStitch.label}`
    : 'No stitches compiled';

  const startColResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = editorWidth;
    setDraggingAxis('col');
    const onMove = (ev: PointerEvent) => {
      const maxW = Math.max(320, Math.floor(window.innerWidth * 0.65));
      setEditorWidth(Math.max(260, Math.min(maxW, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      setDraggingAxis(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startRowResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = outlineHeight;
    setDraggingAxis('row');
    const onMove = (ev: PointerEvent) => {
      const paneH = editorPaneRef.current?.clientHeight ?? 600;
      const maxH = Math.max(140, Math.floor(paneH * 0.72));
      setOutlineHeight(Math.max(76, Math.min(maxH, startH - (ev.clientY - startY))));
    };
    const onUp = () => {
      setDraggingAxis(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="app-shell">
      <header className="top-header">
        <div className="brand-lockup">
          <svg
            width="26"
            height="26"
            viewBox="0 0 64 64"
            aria-hidden="true"
            style={{ flexShrink: 0 }}
          >
            <rect width="64" height="64" rx="15" fill="#0f172a" />
            <circle cx="28" cy="34" r="16" fill="none" stroke="#38bdf8" strokeWidth="5" />
            <path
              d="M36 46 L52 14 C54 10, 49 9, 47 13"
              fill="none"
              stroke="#34d399"
              strokeWidth="4.5"
              strokeLinecap="round"
            />
          </svg>
          <h1>StitchLens</h1>
          <span className="brand-badge">v0.0.1 &middot; 3D Crochet Visualizer</span>
        </div>

        <div className="header-actions">
          <a href="../" className="btn">
            Home
          </a>
          <button
            type="button"
            className="btn mobile-only"
            onClick={() => setMobileTab((m) => (m === 'both' ? 'viewport' : 'both'))}
          >
            {mobileTab === 'both' ? 'Full 3D View' : 'Show Pattern Editor'}
          </button>

          <button type="button" className="btn btn-primary" onClick={galleryModal.openModal}>
            Examples ({EXAMPLE_PATTERNS.length} CC0)
          </button>

          <button type="button" className="btn" onClick={guideModal.openModal}>
            Syntax Guide
          </button>

          <button type="button" className="btn" onClick={() => void handleShareLink()}>
            Share Link
          </button>

          <a
            href="https://github.com/mrpoundsign/StitchLens/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-report-issue"
          >
            ! Report Issue (v0.0.1)
          </a>

          <button
            type="button"
            className="btn"
            onClick={handleToggleTheme}
            aria-label={isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDarkTheme ? 'Light Theme' : 'Dark Theme'}
          </button>
        </div>
      </header>

      <main
        className="workspace-main"
        data-mobile-tab={mobileTab}
        style={{ '--editor-width': `${editorWidth}px` } as React.CSSProperties}
      >
        {/* Left Pane: Live Crochet Scratchpad + Stitch-Count Outline */}
        <aside
          ref={editorPaneRef}
          className="editor-pane"
          aria-label="Pattern Scratchpad and Row Counts"
          style={{ '--outline-height': `${outlineHeight}px` } as React.CSSProperties}
        >
          <div className="pane-toolbar">
            <div className="pane-toolbar-group">
              <label htmlFor={dialectSelectId} style={{ fontSize: '0.76rem', fontWeight: 600 }}>
                Terms:
              </label>
              <select
                id={dialectSelectId}
                className="select-compact"
                value={dialect}
                onChange={(e) => setDialect(e.target.value as CrochetDialect)}
              >
                <option value="US">US Terms (sc / dc)</option>
                <option value="UK">UK Terms (dc / tr)</option>
              </select>
            </div>

            <div className="pane-toolbar-group">
              {implicitTurnRows.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: '0.73rem', paddingBlock: '0.2rem', paddingInline: '0.5rem' }}
                  onClick={handleInsertExplicitTurns}
                >
                  + Fix {implicitTurnRows.length} Omitted Turns
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,text/plain"
                className="visually-hidden"
                aria-label="Load pattern from .txt file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void loadTxtFile(file);
                  }
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn"
                style={{ fontSize: '0.73rem', paddingBlock: '0.2rem', paddingInline: '0.5rem' }}
                onClick={() => fileInputRef.current?.click()}
              >
                Load .txt
              </button>
              <button
                type="button"
                className="btn"
                style={{ fontSize: '0.73rem', paddingBlock: '0.2rem', paddingInline: '0.5rem' }}
                onClick={handleSaveTxtFile}
              >
                Save .txt
              </button>
              <button
                type="button"
                className="btn"
                style={{ fontSize: '0.73rem', paddingBlock: '0.2rem', paddingInline: '0.5rem' }}
                onClick={() => {
                  void navigator.clipboard.writeText(patternText);
                  showToast('Pattern text copied to clipboard!');
                }}
              >
                Copy Text
              </button>
            </div>
          </div>

          <textarea
            ref={textareaRef}
            className="pattern-textarea"
            aria-label="Crochet pattern instructions"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            value={patternText}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              const file = e.dataTransfer?.files?.[0];
              if (file && (file.name.toLowerCase().endsWith('.txt') || file.type === 'text/plain')) {
                e.preventDefault();
                void loadTxtFile(file);
              }
            }}
            onChange={(e) => {
              setActiveExampleId('custom');
              setPatternText(e.target.value);
            }}
          />

          {compiled.diagnostics.length > 0 && (
            <div className="diagnostics-strip" role="status" aria-live="polite">
              {compiled.diagnostics.map((d, idx) => (
                <div key={`${d.line}-${idx}`} className={`diag-item diag-${d.severity}`}>
                  <span>
                    {d.severity === 'error'
                      ? 'Mismatch'
                      : d.severity === 'warning'
                        ? 'Note'
                        : 'Hint'}{' '}
                    (L{d.line}):
                  </span>
                  <span>{d.message}</span>
                </div>
              ))}
            </div>
          )}

          <div
            className="row-resizer"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize pattern editor and row list"
            data-dragging={draggingAxis === 'row'}
            onPointerDown={startRowResize}
          />

          <div className="row-outline">
            <h2 className="row-outline-title">
              Live Row &amp; Stitch Counts ({totalStitches} total loops)
            </h2>
            <ul className="row-pill-list" role="list">
              {compiled.rows.map((row, idx) => {
                const isCurrent =
                  activeStitch !== null &&
                  activeStitch.id >= row.firstStitchId &&
                  activeStitch.id <= row.lastStitchId;
                const pieceObj = compiled.pieces.find((p) => p.id === row.pieceId);
                const hasMismatch =
                  row.declaredCount !== null &&
                  compiled.diagnostics.some(
                    (d) => d.severity === 'error' && d.line === row.sourceLine
                  );

                return (
                  <li key={`${row.pieceId}-${row.rowNumber}-${idx}`}>
                    <button
                      type="button"
                      className={`row-pill ${isCurrent ? 'row-pill-current' : ''}`}
                      onClick={() => {
                        setIsPlaying(false);
                        setCurrentStep(row.lastStitchId);
                        jumpEditorToLine(row.sourceLine);
                      }}
                    >
                      <span>
                        {compiled.pieces.length > 1 && pieceObj ? (
                          <strong style={{ marginInlineEnd: '0.35rem' }}>{pieceObj.name}:</strong>
                        ) : null}
                        {row.label}
                        {row.implicitTurn && <span className="implicit-badge">auto turn</span>}
                      </span>
                      <span className={`count-chip ${hasMismatch ? 'count-chip-mismatch' : ''}`}>
                        {hasMismatch
                          ? `${row.emittedStitchCount} != (${row.declaredCount})`
                          : `${row.emittedStitchCount} sts`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <div
          className="col-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize pattern editor and 3D viewport"
          data-dragging={draggingAxis === 'col'}
          onPointerDown={startColResize}
        />

        {/* Right Pane: Interactive 3D Viewport */}
        <section className="viewport-pane" aria-label="3D Crochet Viewport">
          <div ref={canvasHostRef} className="viewport-canvas-host" />

          {/* Top Floating HUD */}
          <div className="viewport-top-hud">
            {/* Piece Switcher & Interactive 3D Click-to-Pin */}
            <div className="hud-card">
              <button
                type="button"
                className={`btn ${soloPieceId === null ? 'btn-active' : ''}`}
                onClick={() => setSoloPieceId(null)}
              >
                All Pieces ({compiled.pieces.length})
              </button>
              {compiled.pieces.length > 1 &&
                compiled.pieces.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`btn ${soloPieceId === p.id ? 'btn-active' : ''}`}
                    onClick={() => setSoloPieceId(p.id)}
                  >
                    {p.name}
                  </button>
                ))}

              {compiled.pieces.length > 1 && (
                <>
                  <label htmlFor={pinPieceSelectId} className="visually-hidden">
                    Pin piece in 3D by clicking a target stitch
                  </label>
                  <select
                    id={pinPieceSelectId}
                    className="select-compact"
                    value={pinningPieceId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      setPinningPieceId(val);
                      if (val) {
                        setSoloPieceId(null);
                        const pName =
                          compiled.pieces.find((p) => p.id === val)?.name ?? 'Piece';
                        showToast(
                          `Click any stitch on another piece in 3D to attach ${pName} there!`
                        );
                      }
                    }}
                  >
                    <option value="">Pin Piece in 3D...</option>
                    {compiled.pieces.slice(1).map((p) => (
                      <option key={p.id} value={p.id}>
                        Pin &ldquo;{p.name}&rdquo; &rarr; Click 3D Stitch
                      </option>
                    ))}
                  </select>
                  {pinningPieceId && (
                    <button
                      type="button"
                      className="btn btn-active"
                      onClick={() => setPinningPieceId(null)}
                    >
                      Cancel Pin
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Render & Color Controls */}
            <div className="hud-card">
              <button
                type="button"
                className={`btn ${viewMode === 'yarn' ? 'btn-active' : ''}`}
                onClick={() => setViewMode('yarn')}
              >
                Plush Yarn
              </button>
              <button
                type="button"
                className={`btn ${viewMode === 'diagram' ? 'btn-active' : ''}`}
                onClick={() => setViewMode('diagram')}
              >
                Diagram 3D
              </button>

              <label htmlFor={colorModeSelectId} className="visually-hidden">
                Color coding mode
              </label>
              <select
                id={colorModeSelectId}
                className="select-compact"
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value as ColorSchemeMode)}
              >
                <option value="yarn">Color: Pattern Yarn</option>
                <option value="rows">Color: Alternating Rows</option>
                <option value="stitch_type">Color: Stitch Types</option>
                <option value="tension">Color: Stretch / Tension</option>
              </select>

              <button
                type="button"
                className={`btn ${leftHanded ? 'btn-active' : ''}`}
                onClick={() => setLeftHanded((h) => !h)}
              >
                {leftHanded ? 'Left-Handed' : 'Right-Handed'}
              </button>

              <button
                type="button"
                className="btn"
                onClick={() => viewportRef.current?.fitCameraToVisible()}
              >
                Reset Camera
              </button>
            </div>
          </div>

          {/* Active Stitch & Hook Insertion Spotlight Card */}
          {activeStitch && (
            <div className="stitch-spotlight-card">
              <div className="spotlight-header">
                <span
                  className="color-dot"
                  style={{ backgroundColor: activeStitch.colorHex }}
                  aria-hidden="true"
                />
                <span>
                  {activePiece?.name ?? 'Piece'} &middot;{' '}
                  {activeRow?.label ?? `Row ${activeStitch.rowNumber}`} &middot;{' '}
                  {activeStitch.isRightSide ? 'Right Side (RS)' : 'Wrong Side (WS)'}
                </span>
              </div>
              <p className="spotlight-main">
                Stitch {clampedStep + 1} of {totalStitches}: <code>{activeStitch.label}</code>
              </p>
              <p className="spotlight-sub">
                {activeStitch.anchors.length === 0 ? (
                  'Yarn over and pull through loop on hook (unanchored chain).'
                ) : activeStitch.anchors.length === 1 ? (
                  <>
                    Insert hook into{' '}
                    <strong>{SITE_LABELS[activeStitch.anchors[0].site]}</strong> of Stitch #
                    {activeStitch.anchors[0].targetStitchId + 1} (glowing green ring).
                  </>
                ) : (
                  <>
                    Decrease across{' '}
                    <strong>{activeStitch.anchors.length} parent stitches</strong> (#
                    {activeStitch.anchors.map((a) => a.targetStitchId + 1).join(' & #')}).
                  </>
                )}
              </p>
              {activeMilestone && (
                <div className="milestone-callout">
                  <strong>Craft Step:</strong> {activeMilestone.text}
                </div>
              )}
            </div>
          )}

          {/* Color Legend when Stitch Type or Tension Heatmap is active */}
          {colorMode === 'stitch_type' && (
            <div className="legend-card">
              {(['ch', 'sl_st', 'sc', 'hdc', 'dc', 'tr'] as const).map((k) => (
                <span
                  key={k}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.28rem' }}
                >
                  <span
                    className="color-dot"
                    style={{ backgroundColor: STITCH_TYPE_COLORS[k] }}
                    aria-hidden="true"
                  />
                  {k.replace('_', ' ')}
                </span>
              ))}
            </div>
          )}

          {colorMode === 'tension' && (
            <div className="legend-card">
              <span>Blue: Loose/Compressed</span>
              <span>Green: Relaxed (1.0x)</span>
              <span>Red: High Stretch (&gt;1.4x)</span>
            </div>
          )}
        </section>
      </main>

      {/* Bottom Interactive Stitch & Row Scrubber */}
      <footer className="scrubber-bar">
        <div className="transport-buttons">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setIsPlaying(false);
              setCurrentStep(0);
            }}
            disabled={clampedStep <= 0}
            aria-label="Jump to first stitch"
          >
            |&laquo;
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => stepByRow(-1)}
            disabled={clampedStep <= 0}
          >
            &minus;Row
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => {
              setIsPlaying(false);
              setCurrentStep(Math.max(0, clampedStep - 1));
            }}
            disabled={clampedStep <= 0}
          >
            &larr; Stitch
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (!isPlaying && clampedStep >= totalStitches - 1) {
                setCurrentStep(0);
              }
              setIsPlaying((p) => !p);
            }}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => {
              setIsPlaying(false);
              setCurrentStep(Math.min(totalStitches - 1, clampedStep + 1));
            }}
            disabled={clampedStep >= totalStitches - 1}
          >
            Stitch &rarr;
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => stepByRow(1)}
            disabled={clampedStep >= totalStitches - 1}
          >
            +Row
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => {
              setIsPlaying(false);
              setCurrentStep(Math.max(0, totalStitches - 1));
            }}
            disabled={clampedStep >= totalStitches - 1}
            aria-label="Jump to finished piece"
          >
            &raquo;|
          </button>
        </div>

        <div className="slider-wrap">
          <label htmlFor={sliderId} className="visually-hidden">
            Scrub through stitches
          </label>
          <input
            ref={sliderRef}
            id={sliderId}
            type="range"
            className="stitch-slider"
            min={0}
            max={Math.max(0, totalStitches - 1)}
            step={1}
            value={clampedStep}
            aria-valuetext={sliderAriaText}
            onChange={(e) => {
              setIsPlaying(false);
              setCurrentStep(Number(e.target.value));
            }}
          />
          <span className="slider-readout">
            {totalStitches > 0 ? `${clampedStep + 1} / ${totalStitches}` : '0 / 0'}
          </span>
        </div>

        <div className="scrubber-toggles">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showGhostFuture}
              onChange={(e) => setShowGhostFuture(e.target.checked)}
            />
            <span>Ghost Future</span>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={autoFollowHook}
              onChange={(e) => setAutoFollowHook(e.target.checked)}
            />
            <span>Follow Hook</span>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={stuffingOverride ?? (activePiece?.stuffed ?? true)}
              onChange={(e) => setStuffingOverride(e.target.checked)}
            />
            <span>Stuffing</span>
          </label>
        </div>
      </footer>

      {toastMsg && (
        <div className="toast-banner" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}

      <ExampleGalleryDialog
        dialogRef={galleryModal.dialogRef}
        activeExampleId={activeExampleId}
        onSelectExample={handleSelectExample}
      />

      <SyntaxGuideDialog dialogRef={guideModal.dialogRef} />
    </div>
  );
}
