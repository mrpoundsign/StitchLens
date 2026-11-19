export type CrochetDialect = 'US' | 'UK' | 'ES';

export type PieceWorkMode = 'unknown' | 'flat_rows' | 'spiral_rounds' | 'joined_rounds';

export type StitchKind =
  | 'magic_ring'
  | 'ch'
  | 'sl_st'
  | 'sc'
  | 'hdc'
  | 'dc'
  | 'tr'
  | 'cluster'
  | 'bobble'
  | 'puff'
  | 'popcorn';

export type AttachmentSite =
  | 'both_loops'
  | 'flo'
  | 'blo'
  | 'front_post'
  | 'back_post'
  | 'chain_space'
  | 'chain_underside'
  | 'row_end_post'
  | 'ring_center';

export interface StitchDimensions {
  width: number;
  height: number;
  bulge: number;
}

export const STITCH_DIMENSIONS: Record<StitchKind, StitchDimensions> = {
  magic_ring: { width: 0.15, height: 0.05, bulge: 0 },
  ch: { width: 0.92, height: 0.35, bulge: 0 },
  sl_st: { width: 0.88, height: 0.28, bulge: 0 },
  sc: { width: 1.0, height: 1.0, bulge: 0 },
  hdc: { width: 1.04, height: 1.45, bulge: 0 },
  dc: { width: 1.08, height: 2.0, bulge: 0 },
  tr: { width: 1.12, height: 2.65, bulge: 0 },
  cluster: { width: 1.12, height: 1.85, bulge: 0.55 },
  bobble: { width: 1.15, height: 1.5, bulge: 0.85 },
  puff: { width: 1.1, height: 1.55, bulge: 0.75 },
  popcorn: { width: 1.15, height: 1.55, bulge: 0.9 },
};

export interface SourceSpan {
  line: number; // 1-based editor line
  colStart: number;
  colEnd: number;
}

export interface StitchAnchor {
  targetStitchId: number;
  site: AttachmentSite;
}

export interface StitchNode {
  id: number;
  pieceId: string;
  rowNumber: number;
  rowSourceLine: number;
  indexInRow: number;
  kind: StitchKind;
  label: string;
  colorHex: string;
  isRightSide: boolean;
  isTurningChain: boolean;
  implicitTurnBefore: boolean;
  prevStitchId: number | null;
  anchors: StitchAnchor[];
  chainSpaceId?: number;
  bulgeBias?: number;
  sourceSpan: SourceSpan;
}

export interface ChainSpaceGroup {
  id: number;
  pieceId: string;
  rowNumber: number;
  chainStitchIds: number[];
}

export interface RowSummary {
  pieceId: string;
  rowNumber: number;
  sourceLine: number;
  label: string;
  emittedStitchCount: number;
  declaredCount: number | null;
  firstStitchId: number;
  lastStitchId: number;
  implicitTurn: boolean;
  workMode: PieceWorkMode;
  isBorder: boolean;
}

export interface PieceSummary {
  id: string;
  name: string;
  workMode: PieceWorkMode;
  stuffed: boolean;
  closedBottom: boolean;
  stitchIds: number[];
  defaultOffset: [number, number, number];
  defaultRotation: [number, number, number];
}

export interface StemSpec {
  id: string;
  points: [number, number, number][];
  colorHex: string;
  radius: number;
}

export type AssemblyConstraint =
  | {
      kind: 'seam';
      pieceA: string;
      stitchesA: number[];
      pieceB: string;
      stitchesB: number[];
    }
  | {
      kind: 'attach' | 'glue';
      childPiece: string;
      childStitches: number[];
      hostTarget:
        | {
            kind: 'surface';
            hostPiece: string;
            round: number;
            startStitch: number;
            endStitch: number;
            compassFraction?: number; // 0..1 around round (right=0, front=0.25, left=0.5, back=0.75)
            offsetNormal?: number;
          }
        | {
            kind: 'stem';
            stemId: string;
            t: number;
            angleRad: number;
            tiltRad?: number;
          };
    }
  | {
      kind: 'coil';
      pieceId: string;
      edgeStitches: number[];
      pitch: number;
      innerRadius: number;
      stemId?: string;
    };

export interface MilestoneAnnotation {
  afterStitchId: number;
  pieceId: string;
  kind: 'embroider' | 'glue' | 'stuff' | 'fasten_off' | 'note';
  text: string;
  sourceLine: number;
}

export interface PatternDiagnostic {
  severity: 'error' | 'warning' | 'info';
  line: number;
  message: string;
  suggestion?: string;
}

export interface CompiledPattern {
  stitches: StitchNode[];
  rows: RowSummary[];
  pieces: PieceSummary[];
  chainSpaces: ChainSpaceGroup[];
  assemblies: AssemblyConstraint[];
  stems: StemSpec[];
  annotations: MilestoneAnnotation[];
  diagnostics: PatternDiagnostic[];
}

export interface SolvedGeometry {
  positions: Float32Array; // length = 3 * N
  tangents: Float32Array;  // length = 3 * N
  normals: Float32Array;   // length = 3 * N
  stress: Float32Array;    // length = N (1.0 = ideal rest length)
}

export interface PatternNormalizerAdapter {
  name: string;
  normalizeProsePattern(rawText: string, dialect: CrochetDialect): Promise<string>;
}
