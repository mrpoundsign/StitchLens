import {
  AssemblyConstraint,
  AttachmentSite,
  ChainSpaceGroup,
  CompiledPattern,
  CrochetDialect,
  MilestoneAnnotation,
  PatternDiagnostic,
  PieceSummary,
  PieceWorkMode,
  RowSummary,
  SourceSpan,
  StitchAnchor,
  StitchKind,
  StitchNode,
} from '../model/types';
import { PatternAst, PieceAst, RowAst, StatementNode, TargetMode } from '../parser/ast';
import { DEFAULT_PIECE_PALETTE } from '../parser/colors';
import { parsePattern } from '../parser/parser';

interface FlatBoundarySlot {
  stitchId: number;
  defaultSite: AttachmentSite;
}

interface SpiralTarget {
  stitchId: number;
  site: AttachmentSite;
}

class PieceCompiler {
  private piece: PieceAst;
  private stitches: StitchNode[];
  private rows: RowSummary[];
  private chainSpaces: ChainSpaceGroup[];
  private annotations: MilestoneAnnotation[];
  private diagnostics: PatternDiagnostic[];

  private workMode: PieceWorkMode = 'unknown';
  private isRightSide = true;
  private activeColorHex: string;
  private prevStitchId: number | null = null;
  private closedBottom = false;

  // Spiral / Joined round state
  private magicRingId: number | null = null;
  private isJoinedChainRing = false;
  private ringClusterCursor = 0;
  private spiralQueue: SpiralTarget[] = [];
  private currentRoundFirstStitchId: number | null = null;
  private prevChainSpaces: ChainSpaceGroup[] = [];
  private currentRowChainSpaces: ChainSpaceGroup[] = [];

  // Flat-row spliced boundary state (Left-to-Right in RS space)
  private flatBoundary: FlatBoundarySlot[] = [];
  private flatCursor = 0; // Index in flatBoundary
  private flatDir: 1 | -1 = 1; // +1 on RS, -1 on WS
  private hasWorkedInCurrentFlatPass = false;
  private foundationIds: number[] = [];
  private rowEdgeHistory: Array<{ leftId: number; rightId: number }> = [];

  constructor(
    piece: PieceAst,
    pieceIndex: number,
    stitches: StitchNode[],
    rows: RowSummary[],
    chainSpaces: ChainSpaceGroup[],
    annotations: MilestoneAnnotation[],
    diagnostics: PatternDiagnostic[]
  ) {
    this.piece = piece;
    this.stitches = stitches;
    this.rows = rows;
    this.chainSpaces = chainSpaces;
    this.annotations = annotations;
    this.diagnostics = diagnostics;
    this.activeColorHex =
      piece.initialColorHex ?? DEFAULT_PIECE_PALETTE[pieceIndex % DEFAULT_PIECE_PALETTE.length];
  }

  public compile(pieceIndex: number): PieceSummary {
    const startGlobalIdx = this.stitches.length;

    // Emit annotations that appear before any row
    this.flushAnnotationsForRow(-1);

    for (let rIdx = 0; rIdx < this.piece.rows.length; rIdx++) {
      const rowAst = this.piece.rows[rIdx];
      this.compileRow(rowAst, rIdx);
      this.flushAnnotationsForRow(rIdx);
    }

    const stitchIds: number[] = [];
    for (let i = startGlobalIdx; i < this.stitches.length; i++) {
      stitchIds.push(this.stitches[i].id);
    }

    const hasDecreases = stitchIds.some((id) => this.stitches[id].anchors.length > 1);
    const inferredStuffed =
      this.piece.stuffedOverride ??
      (this.workMode === 'spiral_rounds' && this.piece.rows.length >= 4 && hasDecreases);

    // Default 3D kit-grid spatial offset (4 columns per row) if multiple pieces exist and aren't attached
    const gridCol = pieceIndex % 4;
    const gridRow = Math.floor(pieceIndex / 4);
    const defaultOffset: [number, number, number] = this.piece.defaultOffset ?? [
      gridCol * 18,
      0,
      gridRow * 18,
    ];
    const defaultRotation: [number, number, number] = this.piece.defaultRotation ?? [0, 0, 0];

    return {
      id: this.piece.id,
      name: this.piece.name,
      sourceLine: this.piece.sourceLine,
      workMode: this.workMode === 'unknown' ? 'flat_rows' : this.workMode,
      stuffed: inferredStuffed,
      closedBottom: this.closedBottom,
      stitchIds,
      defaultOffset,
      defaultRotation,
    };
  }

  private flushAnnotationsForRow(rowIdx: number): void {
    for (const ann of this.piece.annotations) {
      if (ann.afterRowIndex === rowIdx) {
        const afterStitchId =
          this.stitches.length > 0 ? this.stitches[this.stitches.length - 1].id : -1;
        this.annotations.push({
          afterStitchId,
          pieceId: this.piece.id,
          kind: ann.kind,
          text: ann.text,
          sourceLine: ann.sourceLine,
        });
      }
    }
  }

  private emitStitch(params: {
    rowNumber: number;
    rowSourceLine: number;
    indexInRow: number;
    kind: StitchKind;
    label: string;
    isTurningChain?: boolean;
    implicitTurnBefore?: boolean;
    anchors: StitchAnchor[];
    span: SourceSpan;
    bulgeBias?: number;
  }): StitchNode {
    const id = this.stitches.length;
    const node: StitchNode = {
      id,
      pieceId: this.piece.id,
      rowNumber: params.rowNumber,
      rowSourceLine: params.rowSourceLine,
      indexInRow: params.indexInRow,
      kind: params.kind,
      label: params.label,
      colorHex: this.activeColorHex,
      isRightSide: this.isRightSide,
      isTurningChain: params.isTurningChain ?? false,
      implicitTurnBefore: params.implicitTurnBefore ?? false,
      prevStitchId: this.prevStitchId,
      anchors: params.anchors,
      bulgeBias: params.bulgeBias,
      sourceSpan: params.span,
    };
    this.stitches.push(node);
    this.prevStitchId = id;
    return node;
  }

  private hasExplicitTurn(stmts: StatementNode[]): boolean {
    for (const s of stmts) {
      if (s.type === 'turn_op') return true;
      if (s.type === 'repeat_op' && this.hasExplicitTurn(s.body)) return true;
    }
    return false;
  }

  private pieceUsesFlatTurnsOrRows(): boolean {
    return this.piece.rows.some(
      (r) => r.explicitModeHint === 'row' || this.hasExplicitTurn(r.statements)
    );
  }

  private hasTurnOrBorder(stmts: StatementNode[]): boolean {
    for (const s of stmts) {
      if (s.type === 'turn_op' || s.type === 'border_op') return true;
      if (s.type === 'repeat_op' && this.hasTurnOrBorder(s.body)) return true;
    }
    return false;
  }

  private hasOnlyColorChange(stmts: StatementNode[]): boolean {
    return stmts.length > 0 && stmts.every((s) => s.type === 'color_op');
  }

  private estimateParentsNeeded(stmts: StatementNode[]): number {
    let needed = 0;
    for (const s of stmts) {
      if (s.type === 'stitch_op') {
        if (s.target.kind === 'magic_ring' || s.stitch === 'ch' || s.stitch === 'magic_ring') {
          continue;
        }
        if (s.target.kind === 'same_stitch') {
          needed += 1;
        } else {
          needed += s.count * s.consumePerStitch;
        }
      } else if (s.type === 'skip_op') {
        needed += s.count;
      } else if (s.type === 'repeat_op' && typeof s.times === 'number') {
        if (s.sharedTarget) {
          needed += s.times;
        } else {
          needed += s.times * this.estimateParentsNeeded(s.body);
        }
      }
    }
    return needed;
  }

  private executeTurn(
    span: SourceSpan,
    rowNumber: number,
    rowSourceLine: number,
    emitChain: boolean,
    isImplicit: boolean,
    emittedRowIds?: number[]
  ): void {
    if (this.workMode === 'unknown') {
      this.workMode = 'flat_rows';
    } else if (this.workMode === 'spiral_rounds' || this.workMode === 'joined_rounds') {
      // Transition from in-the-round cap into back-and-forth flat short-row flap (e.g. Hair neck flap!)
      this.workMode = 'flat_rows';
      const activeIds =
        emittedRowIds && emittedRowIds.length > 0
          ? emittedRowIds
          : this.spiralQueue.map((q) => q.stitchId);
      this.flatBoundary = activeIds.map((id) => ({
        stitchId: id,
        defaultSite: 'both_loops',
      }));
      this.flatDir = 1;
      this.flatCursor = this.flatBoundary.length - 1;
    }
    if (emitChain) {
      this.emitStitch({
        rowNumber,
        rowSourceLine,
        indexInRow: 0,
        kind: 'ch',
        label: isImplicit ? 'ch 1 (implicit turn)' : 'ch 1 (turning chain)',
        isTurningChain: true,
        implicitTurnBefore: isImplicit,
        anchors: [],
        span,
      });
    }
    this.isRightSide = !this.isRightSide;
    this.flatDir = this.flatDir === 1 ? -1 : 1;
    if (this.prevChainSpaces.length > 1) {
      this.prevChainSpaces.reverse();
    }
    // Place cursor at the last-modified end of the boundary in the new direction!
    if (this.flatBoundary.length > 0) {
      if (this.flatCursor < 0) this.flatCursor = 0;
      if (this.flatCursor >= this.flatBoundary.length) {
        this.flatCursor = this.flatBoundary.length - 1;
      }
    }
    this.hasWorkedInCurrentFlatPass = false;
  }

  private compileRow(rowAst: RowAst, rIdx: number): void {
    if (this.hasOnlyColorChange(rowAst.statements)) {
      for (const s of rowAst.statements) {
        if (s.type === 'color_op') this.activeColorHex = s.colorHex;
      }
      return;
    }

    // Mode hints from header
    if (this.workMode === 'unknown') {
      if (rowAst.explicitModeHint === 'round') {
        this.workMode = 'spiral_rounds';
      } else if (rowAst.explicitModeHint === 'row') {
        this.workMode = 'flat_rows';
      }
    }

    if (rowAst.sideHint === 'RS') this.isRightSide = true;
    if (rowAst.sideHint === 'WS') this.isRightSide = false;

    const rowFirstGlobalIdx = this.stitches.length;
    let implicitTurnTriggered = false;

    // Check if Piece is missing foundation (e.g., snippet pasted starting at "3. Chain, turn, 2 inc (4)"!)
    if (rIdx === 0 && this.flatBoundary.length === 0 && this.spiralQueue.length === 0) {
      const firstNonTurn = rowAst.statements.find(
        (s) => s.type !== 'turn_op' && s.type !== 'color_op' && !(s.type === 'stitch_op' && s.stitch === 'ch' && rowAst.statements.some((t) => t.type === 'turn_op'))
      );
      const startsWithFoundation =
        firstNonTurn &&
        firstNonTurn.type === 'stitch_op' &&
        (firstNonTurn.stitch === 'ch' ||
          firstNonTurn.stitch === 'magic_ring' ||
          firstNonTurn.target.kind === 'magic_ring');

      if (!startsWithFoundation) {
        const needed = Math.max(2, this.estimateParentsNeeded(rowAst.statements));
        const synthSpan: SourceSpan = { line: rowAst.sourceLine, colStart: 1, colEnd: 1 };
        const hasTurn = this.hasTurnOrBorder(rowAst.statements);
        const isFlatPiece = hasTurn || this.pieceUsesFlatTurnsOrRows();
        this.workMode = isFlatPiece ? 'flat_rows' : 'spiral_rounds';
        if (!isFlatPiece) {
          this.closedBottom = false;
        }

        for (let k = 0; k < needed; k++) {
          const chNode = this.emitStitch({
            rowNumber: Math.max(0, rowAst.rowNumber - 1),
            rowSourceLine: rowAst.sourceLine,
            indexInRow: k,
            kind: 'ch',
            label: `foundation ch ${k + 1} (inferred)`,
            anchors: [],
            span: synthSpan,
          });
          this.foundationIds.push(chNode.id);
          if (this.workMode === 'flat_rows') {
            this.flatBoundary.push({ stitchId: chNode.id, defaultSite: 'both_loops' });
          } else {
            this.spiralQueue.push({ stitchId: chNode.id, site: 'both_loops' });
          }
        }
        if (this.workMode === 'flat_rows') {
          // Position cursor at right end if Row 3 immediately does "Chain, turn", or left end otherwise
          this.flatCursor = hasTurn ? this.flatBoundary.length - 1 : 0;
          this.flatDir = hasTurn ? 1 : 1;
        }
        this.diagnostics.push({
          severity: 'info',
          line: rowAst.sourceLine,
          message: `Auto-created ${needed} foundation stitches so this mid-pattern snippet can render in 3D.`,
        });
      }
    }

    // Check for Implicit Flat-Row Turn! (e.g., Rows 7-12 in screenshot omitted "Chain, turn")
    if (
      rIdx > 0 &&
      this.workMode === 'flat_rows' &&
      this.hasWorkedInCurrentFlatPass &&
      !this.hasTurnOrBorder(rowAst.statements)
    ) {
      implicitTurnTriggered = true;
      const headerSpan: SourceSpan = { line: rowAst.sourceLine, colStart: 1, colEnd: 4 };
      this.executeTurn(headerSpan, rowAst.rowNumber, rowAst.sourceLine, true, true);
    }

    // Swap chain-space buffers for the new row/round
    if (this.currentRowChainSpaces.length > 0) {
      this.prevChainSpaces = this.currentRowChainSpaces;
      this.currentRowChainSpaces = [];
    }
    this.currentRoundFirstStitchId = null;

    const state = {
      rowNumber: rowAst.rowNumber,
      rowSourceLine: rowAst.sourceLine,
      workedCount: 0, // Non-turning stitches
      nonChainWorkedCount: 0,
      hasAnchoredInRow: false,
      rowLoopMode: 'both_loops' as AttachmentSite,
      emittedRowIds: [] as number[],
      isBorderRow: false,
    };

    this.executeStatements(rowAst.statements, state);

    // Record left & right edge stitches for flat rows (used by Perimeter Border Walker!)
    if (this.workMode === 'flat_rows' && state.emittedRowIds.length > 0 && !state.isBorderRow) {
      const firstId = state.emittedRowIds[0];
      const lastId = state.emittedRowIds[state.emittedRowIds.length - 1];
      this.rowEdgeHistory.push(
        this.flatDir === 1
          ? { leftId: firstId, rightId: lastId }
          : { leftId: lastId, rightId: firstId }
      );
    }

    const rowLastGlobalIdx = this.stitches.length - 1;
    if (rowLastGlobalIdx >= rowFirstGlobalIdx) {
      // Stitch count verification
      const foundationChainsInRow =
        state.emittedRowIds.length === 0
          ? rowLastGlobalIdx - rowFirstGlobalIdx + 1
          : 0;
      const primaryCount =
        state.nonChainWorkedCount > 0
          ? state.workedCount
          : state.emittedRowIds.length > 0
            ? state.emittedRowIds.length
            : foundationChainsInRow;

      if (rowAst.declaredCount !== null) {
        const matchesTotal = rowAst.declaredCount === state.workedCount;
        const matchesNonChain = rowAst.declaredCount === state.nonChainWorkedCount;
        // Also allow +1 when a starting ch-3 counts as a dc in round/row crochet
        const hasTallTurningChain = this.stitches
          .slice(rowFirstGlobalIdx, rowLastGlobalIdx + 1)
          .some((s) => s.isTurningChain);
        const matchesWithTurningPost =
          hasTallTurningChain && rowAst.declaredCount === state.workedCount + 1;

        if (!matchesTotal && !matchesNonChain && !matchesWithTurningPost) {
          this.diagnostics.push({
            severity: 'error',
            line: rowAst.sourceLine,
            message: `${rowAst.rawHeader}: Pattern declares (${rowAst.declaredCount}), but instructions produce ${primaryCount} stitches.`,
            suggestion: `Update declared count to (${primaryCount}) or adjust your increases/decreases on line ${rowAst.sourceLine}.`,
            fixAction: {
              kind: 'update_declared_count',
              expectedCount: primaryCount,
            },
          });
        }
      }

      this.rows.push({
        pieceId: this.piece.id,
        rowNumber: rowAst.rowNumber,
        sourceLine: rowAst.sourceLine,
        label: rowAst.rawHeader,
        emittedStitchCount: primaryCount,
        declaredCount: rowAst.declaredCount,
        firstStitchId: this.stitches[rowFirstGlobalIdx].id,
        lastStitchId: this.stitches[rowLastGlobalIdx].id,
        implicitTurn: implicitTurnTriggered,
        workMode: this.workMode === 'unknown' ? 'flat_rows' : this.workMode,
        isBorder: state.isBorderRow,
      });
    }
  }

  private countRemainingParents(): number {
    if (this.workMode === 'spiral_rounds' || this.workMode === 'joined_rounds') {
      return this.spiralQueue.length;
    }
    if (this.flatBoundary.length === 0) return 0;
    return this.flatDir === 1
      ? Math.max(0, this.flatBoundary.length - this.flatCursor)
      : Math.max(0, this.flatCursor + 1);
  }

  private consumeParentTarget(preferredSite: AttachmentSite): StitchAnchor[] {
    if (this.workMode === 'spiral_rounds' || this.workMode === 'joined_rounds') {
      const next = this.spiralQueue.shift();
      if (!next) {
        // Fallback to previous stitch if user wrote more stitches than parent round had
        const fallbackId = Math.max(0, this.stitches.length - 1);
        return [{ targetStitchId: fallbackId, site: preferredSite }];
      }
      const site = preferredSite !== 'both_loops' ? preferredSite : next.site;
      return [{ targetStitchId: next.stitchId, site }];
    }

    // Flat mode
    if (this.workMode === 'unknown') {
      this.workMode = 'flat_rows';
    }
    if (this.flatBoundary.length === 0) {
      return [];
    }
    const clampedIdx = Math.max(0, Math.min(this.flatBoundary.length - 1, this.flatCursor));
    const slot = this.flatBoundary[clampedIdx];
    const site = preferredSite !== 'both_loops' ? preferredSite : slot.defaultSite;
    return [{ targetStitchId: slot.stitchId, site }];
  }

  private replaceFlatParentsWithChildren(consumedCount: number, childIds: number[]): void {
    if (this.flatBoundary.length === 0) {
      for (const id of childIds) {
        this.flatBoundary.push({ stitchId: id, defaultSite: 'both_loops' });
      }
      this.flatCursor = this.flatBoundary.length - 1;
      return;
    }

    if (this.flatDir === 1) {
      const start = Math.max(0, Math.min(this.flatBoundary.length - 1, this.flatCursor));
      const actualRemove = Math.min(consumedCount, this.flatBoundary.length - start);
      const newSlots: FlatBoundarySlot[] = childIds.map((id) => ({
        stitchId: id,
        defaultSite: 'both_loops',
      }));
      this.flatBoundary.splice(start, actualRemove, ...newSlots);
      this.flatCursor = start + newSlots.length;
    } else {
      // Moving right-to-left (WS): consume `consumedCount` slots ending at `flatCursor`
      const end = Math.max(0, Math.min(this.flatBoundary.length - 1, this.flatCursor));
      const start = Math.max(0, end - consumedCount + 1);
      const actualRemove = end - start + 1;
      // Children emitted while moving right-to-left sit in reverse order in RS left-to-right coords!
      const newSlots: FlatBoundarySlot[] = [...childIds]
        .reverse()
        .map((id) => ({ stitchId: id, defaultSite: 'both_loops' }));
      this.flatBoundary.splice(start, actualRemove, ...newSlots);
      this.flatCursor = start - 1;
    }
    this.hasWorkedInCurrentFlatPass = true;
  }

  private executeStatements(
    stmts: StatementNode[],
    state: {
      rowNumber: number;
      rowSourceLine: number;
      workedCount: number;
      nonChainWorkedCount: number;
      hasAnchoredInRow: boolean;
      rowLoopMode: AttachmentSite;
      emittedRowIds: number[];
      isBorderRow: boolean;
    },
    sharedAnchorOverride?: StitchAnchor[],
    inRepeatGroup = false
  ): void {
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i];

      switch (stmt.type) {
        case 'color_op': {
          this.activeColorHex = stmt.colorHex;
          break;
        }

        case 'loop_mode_op': {
          state.rowLoopMode = stmt.site;
          break;
        }

        case 'turn_op': {
          this.executeTurn(
            stmt.span,
            state.rowNumber,
            state.rowSourceLine,
            false,
            false,
            state.emittedRowIds
          );
          break;
        }

        case 'fasten_off_op': {
          this.annotations.push({
            afterStitchId: this.stitches.length > 0 ? this.stitches[this.stitches.length - 1].id : -1,
            pieceId: this.piece.id,
            kind: 'fasten_off',
            text: 'Fasten off',
            sourceLine: stmt.span.line,
          });
          break;
        }

        case 'skip_op': {
          if (this.workMode === 'spiral_rounds' || this.workMode === 'joined_rounds') {
            for (let k = 0; k < stmt.count; k++) {
              this.spiralQueue.shift();
            }
          } else {
            this.flatCursor += this.flatDir * stmt.count;
          }
          break;
        }

        case 'opposite_side_op': {
          // Pivot from flat foundation chain into a 3D Oval worked in the round!
          // The hook just rounded `foundationIds[0]` (the left tip) and now works Left-to-Right
          // along the underside of the remaining non-turning foundation chains `foundationIds[1 .. M-1]`.
          this.workMode = 'spiral_rounds';
          this.closedBottom = true;
          this.spiralQueue = [];
          const usableFoundation = this.foundationIds.filter(
            (id) => !this.stitches[id].isTurningChain
          );
          const undersideChains = usableFoundation.slice(1);
          for (const cid of undersideChains) {
            this.spiralQueue.push({ stitchId: cid, site: 'chain_underside' });
          }
          // Followed by all top-side stitches emitted so far in Row 1!
          for (const sid of state.emittedRowIds) {
            this.spiralQueue.push({ stitchId: sid, site: 'both_loops' });
          }
          break;
        }

        case 'join_op': {
          if (stmt.formFoundationRing && this.foundationIds.length > 0) {
            this.workMode = 'joined_rounds';
            this.closedBottom = true;
            this.isJoinedChainRing = true;
            this.ringClusterCursor = 0;
            const firstChId = this.foundationIds[0];
            this.magicRingId = firstChId;
            this.emitStitch({
              rowNumber: state.rowNumber,
              rowSourceLine: state.rowSourceLine,
              indexInRow: state.emittedRowIds.length,
              kind: 'sl_st',
              label: 'sl st (join foundation ring)',
              isTurningChain: true,
              anchors: [{ targetStitchId: firstChId, site: 'both_loops' }],
              span: stmt.span,
            });
            // Clear flat boundary since those chains now form a closed ring!
            this.flatBoundary = [];
          } else if (this.currentRoundFirstStitchId !== null) {
            this.workMode = 'joined_rounds';
            this.emitStitch({
              rowNumber: state.rowNumber,
              rowSourceLine: state.rowSourceLine,
              indexInRow: state.emittedRowIds.length,
              kind: 'sl_st',
              label: 'sl st (join round)',
              isTurningChain: true,
              anchors: [{ targetStitchId: this.currentRoundFirstStitchId, site: 'both_loops' }],
              span: stmt.span,
            });
          }
          break;
        }

        case 'border_op': {
          state.isBorderRow = true;
          this.compilePerimeterBorder(stmt.stitch, stmt.cornerCount, stmt.span, state);
          break;
        }

        case 'repeat_op': {
          if (stmt.sharedTarget) {
            // e.g. "(3 dc, ch 2, 3 dc) in next ch-2 sp" or "V-st"
            const reps = typeof stmt.times === 'number' ? stmt.times : 1;
            for (let r = 0; r < reps; r++) {
              const sharedAnchor = this.resolveSharedTargetAnchor(stmt.sharedTarget, state.rowLoopMode);
              this.executeStatements(stmt.body, state, sharedAnchor, true);
            }
          } else if (typeof stmt.times === 'number') {
            for (let r = 0; r < stmt.times; r++) {
              this.executeStatements(stmt.body, state, sharedAnchorOverride, true);
            }
          } else {
            // Repeat 'around_or_end' until remaining parents <= leaveUnworked
            const perIter = Math.max(1, this.estimateParentsNeeded(stmt.body));
            let guard = 0;
            while (this.countRemainingParents() - stmt.leaveUnworked >= perIter && guard < 250) {
              this.executeStatements(stmt.body, state, sharedAnchorOverride, true);
              guard++;
            }
          }
          break;
        }

        case 'stitch_op': {
          this.executeStitchOp(stmt, i, stmts, state, sharedAnchorOverride, inRepeatGroup);
          break;
        }
      }
    }
  }

  private resolveSharedTargetAnchor(target: TargetMode, defaultSite: AttachmentSite): StitchAnchor[] {
    if (target.kind === 'chain_space') {
      const sp = this.prevChainSpaces.shift();
      if (sp && sp.chainStitchIds.length > 0) {
        // Also remove those chain-space chains from spiralQueue so subsequent stitches land on the stitch AFTER the arch!
        if (this.workMode === 'spiral_rounds' || this.workMode === 'joined_rounds') {
          const lastChId = sp.chainStitchIds[sp.chainStitchIds.length - 1];
          const idxInQ = this.spiralQueue.findIndex((q) => q.stitchId === lastChId);
          if (idxInQ >= 0) {
            this.spiralQueue.splice(0, idxInQ + 1);
          }
        }
        const midId = sp.chainStitchIds[Math.floor(sp.chainStitchIds.length / 2)];
        return [{ targetStitchId: midId, site: 'chain_space' }];
      }
    }
    if (target.kind === 'magic_ring' && this.magicRingId !== null) {
      if (this.isJoinedChainRing && this.foundationIds.length > 0) {
        const ringChId =
          this.foundationIds[this.ringClusterCursor % this.foundationIds.length];
        this.ringClusterCursor++;
        return [{ targetStitchId: ringChId, site: 'ring_center' }];
      }
      return [{ targetStitchId: this.magicRingId, site: 'ring_center' }];
    }
    // Consume 1 parent and share it across all stitches in the group!
    const anchor = this.consumeParentTarget(defaultSite);
    if (this.workMode === 'flat_rows') {
      // Advance cursor past this single shared parent (children will be spliced in)
      this.replaceFlatParentsWithChildren(1, []);
    }
    return anchor;
  }

  private executeStitchOp(
    stmt: Extract<StatementNode, { type: 'stitch_op' }>,
    stmtIdx: number,
    siblingStmts: StatementNode[],
    state: {
      rowNumber: number;
      rowSourceLine: number;
      workedCount: number;
      nonChainWorkedCount: number;
      hasAnchoredInRow: boolean;
      rowLoopMode: AttachmentSite;
      emittedRowIds: number[];
      isBorderRow: boolean;
    },
    sharedAnchorOverride?: StitchAnchor[],
    inRepeatGroup = false
  ): void {
    const effectiveSite = stmt.site !== 'both_loops' ? stmt.site : state.rowLoopMode;

    // Case A: Explicit magic_ring stitch
    if (stmt.stitch === 'magic_ring') {
      this.workMode = 'spiral_rounds';
      this.closedBottom = true;
      const mr = this.emitStitch({
        rowNumber: state.rowNumber,
        rowSourceLine: state.rowSourceLine,
        indexInRow: 0,
        kind: 'magic_ring',
        label: 'Magic Ring',
        isTurningChain: true,
        anchors: [],
        span: stmt.span,
      });
      this.magicRingId = mr.id;
      return;
    }

    // Case B: Chain stitches (`ch N`)
    if (stmt.stitch === 'ch') {
      const isInitialFoundation =
        this.stitches.every((s) => s.pieceId !== this.piece.id) &&
        this.magicRingId === null;

      const nextSibling = siblingStmts[stmtIdx + 1];
      const isPicotChain =
        nextSibling?.type === 'stitch_op' && nextSibling.target.kind === 'picot_base';

      // Is this a turning chain? (e.g. "Chain, turn" or "ch 1" at very start of a non-foundation row)
      const followedByTurn =
        siblingStmts.slice(stmtIdx + 1).some((s) => s.type === 'turn_op') && !state.hasAnchoredInRow;
      const isStartOfRowTurning =
        !inRepeatGroup &&
        !isInitialFoundation &&
        !state.hasAnchoredInRow &&
        state.emittedRowIds.length === 0;
      const isTurning = followedByTurn || isStartOfRowTurning;

      const createdChainIds: number[] = [];
      for (let k = 0; k < stmt.count; k++) {
        const chNode = this.emitStitch({
          rowNumber: state.rowNumber,
          rowSourceLine: state.rowSourceLine,
          indexInRow: state.emittedRowIds.length,
          kind: 'ch',
          label: isInitialFoundation
            ? `foundation ch ${k + 1}`
            : isPicotChain
              ? `picot ch ${k + 1}`
              : isTurning
                ? `turning ch ${k + 1}`
                : `ch ${k + 1}`,
          isTurningChain: isTurning || isPicotChain,
          anchors: [],
          span: stmt.span,
        });
        createdChainIds.push(chNode.id);

        if (isInitialFoundation) {
          this.foundationIds.push(chNode.id);
        } else if (!isTurning && !isPicotChain) {
          state.workedCount++;
          state.emittedRowIds.push(chNode.id);
        }
      }

      if (isInitialFoundation) {
        const isCircularChainFoundation = !this.pieceUsesFlatTurnsOrRows();
        if (this.workMode === 'unknown') {
          this.workMode = isCircularChainFoundation ? 'spiral_rounds' : 'flat_rows';
        }
        if (this.workMode === 'spiral_rounds' || this.workMode === 'joined_rounds') {
          // Circular foundation chain (e.g. "chain 30" or "Rnd 1: ch 30" followed by "Rnd 2: 1sc in each stitch around (30)"):
          // populate spiralQueue with all foundation chains so Rnd 2 works around the 30-chain ring!
          this.closedBottom = false;
          this.spiralQueue = createdChainIds.map((id) => ({
            stitchId: id,
            site: 'both_loops',
          }));
        } else {
          // Put foundation chains on flatBoundary (left-to-right `0..N-1`), hook starts at right end (`N-1`, going `-1` back toward `0`)!
          this.flatBoundary = createdChainIds.map((id) => ({
            stitchId: id,
            defaultSite: 'both_loops',
          }));
          this.flatDir = -1;
          this.flatCursor = this.flatBoundary.length - 1;
        }
      } else if (!isTurning && !isPicotChain && createdChainIds.length > 0) {
        // Register as an addressable chain-space arch for the next row/round!
        const csGroup: ChainSpaceGroup = {
          id: this.chainSpaces.length,
          pieceId: this.piece.id,
          rowNumber: state.rowNumber,
          chainStitchIds: createdChainIds,
        };
        this.chainSpaces.push(csGroup);
        this.currentRowChainSpaces.push(csGroup);
        for (const cid of createdChainIds) {
          this.stitches[cid].chainSpaceId = csGroup.id;
        }
        // Also place chain stitches onto spiralQueue / flatBoundary so patterns working directly into chains still work!
        if (this.workMode === 'spiral_rounds' || this.workMode === 'joined_rounds') {
          for (const cid of createdChainIds) {
            this.spiralQueue.push({ stitchId: cid, site: 'both_loops' });
          }
        } else if (this.workMode === 'flat_rows') {
          this.replaceFlatParentsWithChildren(0, createdChainIds);
        }
      }
      return;
    }

    // Case B2: Picot closing slip stitch (`target.kind === 'picot_base'`)
    if (stmt.target.kind === 'picot_base') {
      const baseStitchIdx = Math.max(0, this.stitches.length - 1 - stmt.target.chainLength);
      const baseId = this.stitches[baseStitchIdx]?.id ?? Math.max(0, this.stitches.length - 1);
      this.emitStitch({
        rowNumber: state.rowNumber,
        rowSourceLine: state.rowSourceLine,
        indexInRow: state.workedCount,
        kind: stmt.stitch,
        label: 'sl st (close picot)',
        isTurningChain: true,
        anchors: [{ targetStitchId: baseId, site: 'both_loops' }],
        span: stmt.span,
      });
      return;
    }

    // Case C: Target is Magic Ring ("6 sc in a magic ring" or "12 sc in ring")
    if (stmt.target.kind === 'magic_ring') {
      if (this.magicRingId === null) {
        this.workMode = 'spiral_rounds';
        this.closedBottom = true;
        const mr = this.emitStitch({
          rowNumber: state.rowNumber,
          rowSourceLine: state.rowSourceLine,
          indexInRow: 0,
          kind: 'magic_ring',
          label: 'Magic Ring',
          isTurningChain: true,
          anchors: [],
          span: stmt.span,
        });
        this.magicRingId = mr.id;
      }
      const totalToEmit = stmt.count * stmt.fanPerParent;
      for (let k = 0; k < totalToEmit; k++) {
        let ringTargetId = this.magicRingId;
        if (this.isJoinedChainRing && this.foundationIds.length > 0) {
          if (totalToEmit >= this.foundationIds.length) {
            ringTargetId =
              this.foundationIds[
                Math.floor((k * this.foundationIds.length) / totalToEmit) %
                  this.foundationIds.length
              ];
          } else {
            ringTargetId =
              this.foundationIds[this.ringClusterCursor % this.foundationIds.length];
          }
        }
        const st = this.emitStitch({
          rowNumber: state.rowNumber,
          rowSourceLine: state.rowSourceLine,
          indexInRow: state.workedCount,
          kind: stmt.stitch,
          label: `${stmt.stitch.replace('_', ' ')} ${k + 1} in ring`,
          anchors: [{ targetStitchId: ringTargetId, site: 'ring_center' }],
          span: stmt.span,
        });
        if (this.currentRoundFirstStitchId === null) this.currentRoundFirstStitchId = st.id;
        this.spiralQueue.push({ stitchId: st.id, site: 'both_loops' });
        state.workedCount++;
        state.nonChainWorkedCount++;
        state.hasAnchoredInRow = true;
        state.emittedRowIds.push(st.id);
      }
      if (this.isJoinedChainRing && totalToEmit < this.foundationIds.length) {
        this.ringClusterCursor++;
      }
      return;
    }

    // Case D: "in Nth ch from hook" offset adjustment on foundation chain!
    if (stmt.target.kind === 'from_hook') {
      const pieceRowCount = this.rows.filter((r) => r.pieceId === this.piece.id).length;
      if (
        (this.workMode === 'spiral_rounds' || this.workMode === 'joined_rounds') &&
        this.foundationIds.length > 0 &&
        this.spiralQueue.length === this.foundationIds.length &&
        pieceRowCount <= 1
      ) {
        // Started on a chain without turns, but works "in 2nd ch from hook" (linear/oval chain start, not a circular ring!)
        this.workMode = 'flat_rows';
        this.flatBoundary = this.foundationIds.map((id) => ({
          stitchId: id,
          defaultSite: 'both_loops',
        }));
        this.flatDir = -1;
        this.flatCursor = this.flatBoundary.length - 1;
        this.spiralQueue = [];
      }
      if (this.workMode === 'flat_rows') {
        const skipCount = Math.max(1, stmt.target.offset - 1);
        // Mark skipped chains near hook as turning chains and move cursor past them
        for (let s = 0; s < skipCount && this.flatBoundary.length > 0; s++) {
          const idx = Math.max(0, Math.min(this.flatBoundary.length - 1, this.flatCursor));
          const skippedId = this.flatBoundary[idx].stitchId;
          this.stitches[skippedId].isTurningChain = true;
          this.flatBoundary.splice(idx, 1);
          if (this.flatDir === -1) {
            this.flatCursor = idx - 1;
          }
        }
      }
    }

    // Determine how many operations to execute
    let opIterations = stmt.count;
    if (stmt.target.kind === 'all_remaining') {
      const rem = this.countRemainingParents();
      opIterations = Math.max(1, Math.floor(rem / Math.max(1, stmt.consumePerStitch)));
    }

    // Case E: Shared single-stitch fan ("3 sc in last ch", "5 dc in same st", "3 dc in next ch-2 sp", or group sharedAnchorOverride)
    if (
      sharedAnchorOverride ||
      stmt.target.kind === 'same_stitch' ||
      stmt.target.kind === 'chain_space'
    ) {
      const sharedAnchors =
        sharedAnchorOverride ?? this.resolveSharedTargetAnchor(stmt.target, effectiveSite);
      const emittedIds: number[] = [];
      const totalFan = opIterations * stmt.fanPerParent;
      for (let k = 0; k < totalFan; k++) {
        const st = this.emitStitch({
          rowNumber: state.rowNumber,
          rowSourceLine: state.rowSourceLine,
          indexInRow: state.workedCount,
          kind: stmt.stitch,
          label:
            totalFan > 1
              ? `${stmt.stitch.replace('_', ' ')} (${k + 1} of ${totalFan} in same target)`
              : stmt.stitch.replace('_', ' '),
          anchors: sharedAnchors,
          span: stmt.span,
        });
        if (this.currentRoundFirstStitchId === null) this.currentRoundFirstStitchId = st.id;
        emittedIds.push(st.id);
        state.workedCount++;
        state.nonChainWorkedCount++;
        state.hasAnchoredInRow = true;
        state.emittedRowIds.push(st.id);
      }

      if (this.workMode === 'spiral_rounds' || this.workMode === 'joined_rounds') {
        for (const id of emittedIds) {
          this.spiralQueue.push({ stitchId: id, site: 'both_loops' });
        }
      } else if (!sharedAnchorOverride) {
        this.replaceFlatParentsWithChildren(0, emittedIds);
      } else {
        // Inside a shared-target repeat group (like V-stitch)
        this.replaceFlatParentsWithChildren(0, emittedIds);
      }
      return;
    }

    // Case F: Standard sequential stitch operations (`10 sc`, `2 inc`, `dec`, `BLO sc`, `FPdc`)
    for (let iter = 0; iter < opIterations; iter++) {
      // Auto-pivot onto the underside of the foundation chain when a foundation row continues past the left end chain
      // without explicitly writing "working on opposite side of ch" (e.g. Legs Row 2 or Sword Blade Row 1)!
      if (
        this.workMode === 'flat_rows' &&
        this.rowEdgeHistory.length === 0 &&
        this.foundationIds.length >= 3 &&
        this.flatDir === -1 &&
        this.flatCursor < 0
      ) {
        this.workMode = 'spiral_rounds';
        this.closedBottom = true;
        this.spiralQueue = [];
        const usableFoundation = this.foundationIds.filter(
          (id) => !this.stitches[id].isTurningChain
        );
        const leftEndId = usableFoundation[0];
        const countAtLeftEnd = state.emittedRowIds.filter((sid) =>
          this.stitches[sid].anchors.some((a) => a.targetStitchId === leftEndId)
        ).length;
        // If 3+ stitches already fanned into the left end chain (e.g. "4 sc in the same stitch"),
        // start underside at index 1; otherwise include index 0's underside (e.g. "inc x 2" at the turn).
        const startUndersideIdx = countAtLeftEnd >= 3 ? 1 : 0;
        for (const cid of usableFoundation.slice(startUndersideIdx)) {
          this.spiralQueue.push({ stitchId: cid, site: 'chain_underside' });
        }
        for (const sid of state.emittedRowIds) {
          this.spiralQueue.push({ stitchId: sid, site: 'both_loops' });
        }
      }

      if (this.workMode === 'spiral_rounds' || this.workMode === 'joined_rounds') {
        const anchors: StitchAnchor[] = [];
        for (let c = 0; c < stmt.consumePerStitch; c++) {
          anchors.push(...this.consumeParentTarget(effectiveSite));
        }
        for (let f = 0; f < stmt.fanPerParent; f++) {
          const sitePrefix = effectiveSite !== 'both_loops' ? `${effectiveSite.toUpperCase()} ` : '';
          const opName =
            stmt.fanPerParent > 1
              ? `${sitePrefix}inc (${f + 1}/2)`
              : stmt.consumePerStitch > 1
                ? `${sitePrefix}dec (${stmt.consumePerStitch}tog)`
                : `${sitePrefix}${stmt.stitch.replace('_', ' ')}`;

          const st = this.emitStitch({
            rowNumber: state.rowNumber,
            rowSourceLine: state.rowSourceLine,
            indexInRow: state.workedCount,
            kind: stmt.stitch,
            label: opName,
            anchors,
            span: stmt.span,
          });
          if (this.currentRoundFirstStitchId === null) this.currentRoundFirstStitchId = st.id;
          this.spiralQueue.push({ stitchId: st.id, site: 'both_loops' });
          state.workedCount++;
          state.nonChainWorkedCount++;
          state.hasAnchoredInRow = true;
          state.emittedRowIds.push(st.id);
        }
      } else {
        // Flat mode sequential consumption & replacement
        const anchors: StitchAnchor[] = [];
        for (let c = 0; c < stmt.consumePerStitch; c++) {
          const idx = Math.max(
            0,
            Math.min(
              this.flatBoundary.length - 1,
              this.flatCursor + (this.flatDir === 1 ? c : -c)
            )
          );
          if (this.flatBoundary[idx]) {
            const slot = this.flatBoundary[idx];
            anchors.push({
              targetStitchId: slot.stitchId,
              site: effectiveSite !== 'both_loops' ? effectiveSite : slot.defaultSite,
            });
          }
        }

        const childIds: number[] = [];
        for (let f = 0; f < stmt.fanPerParent; f++) {
          const sitePrefix = effectiveSite !== 'both_loops' ? `${effectiveSite.toUpperCase()} ` : '';
          const opName =
            stmt.fanPerParent > 1
              ? `${sitePrefix}inc (${f + 1}/2)`
              : stmt.consumePerStitch > 1
                ? `${sitePrefix}dec (${stmt.consumePerStitch}tog)`
                : `${sitePrefix}${stmt.stitch.replace('_', ' ')}`;

          const st = this.emitStitch({
            rowNumber: state.rowNumber,
            rowSourceLine: state.rowSourceLine,
            indexInRow: state.workedCount,
            kind: stmt.stitch,
            label: opName,
            anchors,
            span: stmt.span,
          });
          childIds.push(st.id);
          state.workedCount++;
          state.nonChainWorkedCount++;
          state.hasAnchoredInRow = true;
          state.emittedRowIds.push(st.id);
        }

        this.replaceFlatParentsWithChildren(stmt.consumePerStitch, childIds);
      }
    }
  }

  /**
   * Walks all 4 sides of a flat panel to crochet a continuous perimeter border
   * (e.g. "CC: to grey, sc a border around and do 2 sc at the corners").
   */
  private compilePerimeterBorder(
    stitchKind: StitchKind,
    cornerCount: number,
    span: SourceSpan,
    state: {
      rowNumber: number;
      rowSourceLine: number;
      workedCount: number;
      nonChainWorkedCount: number;
      hasAnchoredInRow: boolean;
      emittedRowIds: number[];
    }
  ): void {
    const perimeterTargets: Array<{ stitchId: number; site: AttachmentSite; isCorner: boolean }> = [];
    const seen = new Set<string>();
    const addTarget = (stitchId: number, site: AttachmentSite, isCorner: boolean) => {
      const key = `${stitchId}:${site}`;
      if (seen.has(key)) return;
      seen.add(key);
      perimeterTargets.push({ stitchId, site, isCorner });
    };

    // Determine order based on which corner the hook is currently sitting at!
    const topIds = this.flatBoundary.map((b) => b.stitchId);
    const startingAtRight = this.prevStitchId === topIds[topIds.length - 1];

    if (startingAtRight) {
      // Right side down -> Bottom right-to-left -> Left side up -> Top left-to-right
      for (let r = this.rowEdgeHistory.length - 1; r >= 0; r--) {
        addTarget(this.rowEdgeHistory[r].rightId, 'row_end_post', r === this.rowEdgeHistory.length - 1);
      }
      const bottom = [...this.foundationIds].reverse();
      for (let b = 0; b < bottom.length; b++) {
        const isCorner = b === 0 || b === bottom.length - 1;
        addTarget(bottom[b], 'chain_underside', isCorner);
      }
      for (let r = 0; r < this.rowEdgeHistory.length; r++) {
        addTarget(this.rowEdgeHistory[r].leftId, 'row_end_post', r === this.rowEdgeHistory.length - 1);
      }
      for (let t = 0; t < topIds.length; t++) {
        const isCorner = t === 0 || t === topIds.length - 1;
        addTarget(topIds[t], 'both_loops', isCorner);
      }
    } else {
      // Left side down -> Bottom left-to-right -> Right side up -> Top right-to-left
      for (let r = this.rowEdgeHistory.length - 1; r >= 0; r--) {
        addTarget(this.rowEdgeHistory[r].leftId, 'row_end_post', r === this.rowEdgeHistory.length - 1);
      }
      for (let b = 0; b < this.foundationIds.length; b++) {
        const isCorner = b === 0 || b === this.foundationIds.length - 1;
        addTarget(this.foundationIds[b], 'chain_underside', isCorner);
      }
      for (let r = 0; r < this.rowEdgeHistory.length; r++) {
        addTarget(this.rowEdgeHistory[r].rightId, 'row_end_post', r === this.rowEdgeHistory.length - 1);
      }
      const topRev = [...topIds].reverse();
      for (let t = 0; t < topRev.length; t++) {
        const isCorner = t === 0 || t === topRev.length - 1;
        addTarget(topRev[t], 'both_loops', isCorner);
      }
    }

    let firstBorderStitchId: number | null = null;
    for (const target of perimeterTargets) {
      const reps = target.isCorner ? Math.max(1, cornerCount) : 1;
      for (let k = 0; k < reps; k++) {
        const st = this.emitStitch({
          rowNumber: state.rowNumber,
          rowSourceLine: state.rowSourceLine,
          indexInRow: state.workedCount,
          kind: stitchKind,
          label: target.isCorner
            ? `border ${stitchKind.replace('_', ' ')} (corner ${k + 1}/${reps})`
            : `border ${stitchKind.replace('_', ' ')}`,
          anchors: [{ targetStitchId: target.stitchId, site: target.site }],
          span,
        });
        if (firstBorderStitchId === null) firstBorderStitchId = st.id;
        state.workedCount++;
        state.nonChainWorkedCount++;
        state.hasAnchoredInRow = true;
        state.emittedRowIds.push(st.id);
      }
    }

    // Close the perimeter border loop with a slip stitch to the first border stitch!
    if (firstBorderStitchId !== null) {
      this.emitStitch({
        rowNumber: state.rowNumber,
        rowSourceLine: state.rowSourceLine,
        indexInRow: state.workedCount,
        kind: 'sl_st',
        label: 'sl st (close border)',
        isTurningChain: true,
        anchors: [{ targetStitchId: firstBorderStitchId, site: 'both_loops' }],
        span,
      });
    }
  }
}

function hydrateAssemblyConstraints(
  assemblies: AssemblyConstraint[],
  pieces: PieceSummary[],
  stitches: StitchNode[],
  rows: RowSummary[]
): AssemblyConstraint[] {
  const resolvePieceId = (rawRef: string): string => {
    const cleaned = rawRef.trim().toLowerCase();
    const exact = pieces.find((p) => p.id === cleaned || p.name.toLowerCase() === cleaned);
    if (exact) return exact.id;
    const slug = cleaned.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const bySlug = pieces.find(
      (p) => p.id === slug || p.id.startsWith(slug) || slug.startsWith(p.id)
    );
    return bySlug ? bySlug.id : slug;
  };

  return assemblies.map((asm) => {
    if (asm.kind === 'coil') {
      const targetPieceId = resolvePieceId(asm.pieceId);
      const piece = pieces.find((p) => p.id === targetPieceId);
      if (!piece) return asm;
      // Find Row 0 / Row 1 foundation stitches along the bottom of the strip
      const firstRow = rows.find((r) => r.pieceId === piece.id);
      const edgeStitches = piece.stitchIds.filter((id) => {
        const s = stitches[id];
        return s.kind === 'ch' && (firstRow ? s.rowNumber <= firstRow.rowNumber : true);
      });
      return {
        ...asm,
        pieceId: piece.id,
        edgeStitches: edgeStitches.length > 0 ? edgeStitches : piece.stitchIds.slice(0, 12),
      };
    }

    if (asm.kind === 'attach' || asm.kind === 'glue') {
      const childId = resolvePieceId(asm.childPiece);
      const child = pieces.find((p) => p.id === childId);
      if (!child) return asm;
      // Attach by the last open round/row of child (e.g. open base of an ear/snout) or its magic ring center if motif/calyx!
      const childRows = rows.filter((r) => r.pieceId === child.id);
      let childStitches: number[] = [];
      const hostTarget = asm.hostTarget;
      if (hostTarget.kind === 'stem') {
        // Stem attachments (calyx center or leaf base) anchor their very first stitches!
        childStitches = child.stitchIds.slice(0, Math.min(4, child.stitchIds.length));
        return {
          ...asm,
          childPiece: child.id,
          childStitches: childStitches.length > 0 ? childStitches : child.stitchIds.slice(0, 3),
        };
      }

      const hostId = resolvePieceId(hostTarget.hostPiece);
      if (childRows.length > 0) {
        const lastRow = childRows[childRows.length - 1];
        childStitches = child.stitchIds.filter(
          (id) =>
            id >= lastRow.firstStitchId &&
            id <= lastRow.lastStitchId &&
            !stitches[id].isTurningChain
        );
      }

      let startStitch = hostTarget.startStitch;
      let endStitch = hostTarget.endStitch;

      // If compassFraction (0..1 around the round) was specified via plain English ("left of Head"),
      // map it to exact stitch indices on the target round!
      if (hostTarget.compassFraction !== undefined) {
        const hostRow =
          rows.find((r) => r.pieceId === hostId && r.rowNumber === hostTarget.round) ??
          rows.find((r) => r.pieceId === hostId);
        const rowLen = Math.max(1, hostRow?.emittedStitchCount ?? 12);
        const centerIdx = Math.round(hostTarget.compassFraction * rowLen) % rowLen;
        startStitch = Math.max(0, centerIdx - 1);
        endStitch = centerIdx + 1;
      }

      return {
        ...asm,
        childPiece: child.id,
        childStitches: childStitches.length > 0 ? childStitches : child.stitchIds.slice(0, 3),
        hostTarget: {
          ...hostTarget,
          hostPiece: hostId,
          startStitch,
          endStitch,
        },
      };
    }

    return asm;
  });
}

export function compileAst(ast: PatternAst): CompiledPattern {
  const stitches: StitchNode[] = [];
  const rows: RowSummary[] = [];
  const pieces: PieceSummary[] = [];
  const chainSpaces: ChainSpaceGroup[] = [];
  const annotations: MilestoneAnnotation[] = [];
  const diagnostics: PatternDiagnostic[] = [...ast.diagnostics];

  for (let i = 0; i < ast.pieces.length; i++) {
    const pieceCompiler = new PieceCompiler(
      ast.pieces[i],
      i,
      stitches,
      rows,
      chainSpaces,
      annotations,
      diagnostics
    );
    pieces.push(pieceCompiler.compile(i));
  }

  const hydratedAssemblies = hydrateAssemblyConstraints(ast.assemblies, pieces, stitches, rows);

  return {
    stitches,
    rows,
    pieces,
    chainSpaces,
    assemblies: hydratedAssemblies,
    stems: ast.stems,
    annotations,
    diagnostics,
  };
}

export function compilePattern(
  rawText: string,
  options: { dialect?: CrochetDialect } = {}
): CompiledPattern {
  const ast = parsePattern(rawText, options);
  return compileAst(ast);
}
