import {
  AssemblyConstraint,
  AttachmentSite,
  MilestoneAnnotation,
  PatternDiagnostic,
  SourceSpan,
  StemSpec,
  StitchKind,
} from '../model/types';

export type TargetMode =
  | { kind: 'next_each' } // Default: each stitch consumes 1 parent
  | { kind: 'same_stitch' } // Work all into the same parent stitch (e.g. "3 sc in next st", "in last ch")
  | { kind: 'from_hook'; offset: number } // e.g. "in 2nd ch from hook" -> offset = 2
  | { kind: 'chain_space' } // e.g. "in next ch-2 sp"
  | { kind: 'magic_ring' } // e.g. "6 sc in a magic ring"
  | { kind: 'picot_base'; chainLength: number } // Closes a picot into the stitch immediately before its chains
  | { kind: 'all_remaining' }; // e.g. "sc in each st around" / "sc across"

export type StatementNode =
  | {
      type: 'stitch_op';
      stitch: StitchKind;
      count: number; // Number of stitches (or repeats of inc/dec)
      consumePerStitch: number; // 1 for normal, 2 for *2tog/dec, 3 for *3tog, 0 for ch
      fanPerParent: number; // 1 for normal, 2 for inc
      site: AttachmentSite;
      target: TargetMode;
      span: SourceSpan;
    }
  | {
      type: 'repeat_op';
      body: StatementNode[];
      times: number | 'around_or_end';
      leaveUnworked: number; // e.g. "to last 2 sts" -> 2
      sharedTarget?: TargetMode; // e.g. "(3 dc, ch 2, 3 dc) in next ch-2 sp"
      span: SourceSpan;
    }
  | {
      type: 'turn_op';
      span: SourceSpan;
    }
  | {
      type: 'join_op';
      formFoundationRing: boolean;
      span: SourceSpan;
    }
  | {
      type: 'opposite_side_op';
      span: SourceSpan;
    }
  | {
      type: 'skip_op';
      count: number;
      span: SourceSpan;
    }
  | {
      type: 'color_op';
      colorHex: string;
      colorName: string;
      span: SourceSpan;
    }
  | {
      type: 'loop_mode_op';
      site: AttachmentSite;
      span: SourceSpan;
    }
  | {
      type: 'border_op';
      stitch: StitchKind;
      cornerCount: number;
      span: SourceSpan;
    }
  | {
      type: 'fasten_off_op';
      span: SourceSpan;
    };

export interface RowAst {
  rowNumber: number;
  explicitModeHint: 'row' | 'round' | 'auto';
  sideHint?: 'RS' | 'WS';
  declaredCount: number | null;
  statements: StatementNode[];
  sourceLine: number;
  rawHeader: string;
}

export interface PieceAst {
  id: string;
  name: string;
  initialColorHex?: string;
  stuffedOverride?: boolean;
  defaultOffset?: [number, number, number];
  defaultRotation?: [number, number, number];
  rows: RowAst[];
  annotations: Array<Omit<MilestoneAnnotation, 'afterStitchId'> & { afterRowIndex: number }>;
  sourceLine: number;
}

export interface PatternAst {
  pieces: PieceAst[];
  assemblies: AssemblyConstraint[];
  stems: StemSpec[];
  diagnostics: PatternDiagnostic[];
}
