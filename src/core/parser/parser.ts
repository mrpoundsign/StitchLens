import {
  AssemblyConstraint,
  AttachmentSite,
  CrochetDialect,
  MilestoneAnnotation,
  PatternDiagnostic,
  SourceSpan,
  StemSpec,
  StitchKind,
} from '../model/types';
import { PatternAst, PieceAst, StatementNode, TargetMode } from './ast';
import { DEFAULT_PIECE_PALETTE, resolveYarnColor } from './colors';

export interface ParseOptions {
  dialect?: CrochetDialect;
}

function slugifyPieceId(name: string, used: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'piece';
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let idx = 2;
  while (used.has(`${base}_${idx}`)) idx++;
  const candidate = `${base}_${idx}`;
  used.add(candidate);
  return candidate;
}

function mapStitchKind(rawToken: string, dialect: CrochetDialect): StitchKind | null {
  const t = rawToken.toLowerCase().trim();
  if (
    t === 'ch' ||
    t === 'chain' ||
    t === 'chains' ||
    t === 'chs' ||
    t === 'cad' ||
    t === 'cadena' ||
    t === 'cadenas'
  ) {
    return 'ch';
  }
  if (
    t === 'sl st' ||
    t === 'slst' ||
    t === 'sl' ||
    t === 'ss' ||
    t === 'slip stitch' ||
    t === 'slip' ||
    t === 'pd' ||
    t === 'pe' ||
    t === 'punto deslizado' ||
    t === 'punto enano'
  ) {
    return 'sl_st';
  }
  if (
    t === 'mr' ||
    t === 'mc' ||
    t === 'magic ring' ||
    t === 'magic circle' ||
    t === 'am' ||
    t === 'anillo magico' ||
    t === 'anillo mágico'
  ) {
    return 'magic_ring';
  }
  if (t === 'bobble' || t === 'bo' || t === 'mb') return 'bobble';
  if (t === 'puff' || t === 'pf') return 'puff';
  if (t === 'popcorn' || t === 'pc') return 'popcorn';
  if (t === 'cluster' || t === 'cl') return 'cluster';

  // Spanish terms (supported in 'ES' dialect and auto-recognized when unambiguous)
  if (t === 'pb' || t === 'mp' || t === 'punto bajo' || t === 'medio punto') return 'sc';
  if (t === 'pma' || t === 'mpa' || t === 'punto medio alto' || t === 'medio punto alto') {
    return 'hdc';
  }
  if (t === 'pa' || t === 'punto alto' || t === 'vareta') return 'dc';
  if (t === 'pad' || t === 'punto alto doble' || t === 'vareta doble') return 'tr';

  if (dialect === 'UK') {
    // UK crochet terms are shifted by one step relative to US terms!
    if (t === 'dc' || t === 'double crochet') return 'sc';
    if (t === 'htr' || t === 'half treble') return 'hdc';
    if (t === 'tr' || t === 'treble') return 'dc';
    if (t === 'dtr' || t === 'double treble') return 'tr';
    if (t === 'sc') return 'sc';
    if (t === 'hdc') return 'hdc';
    return null;
  }

  // US crochet terms (Craft Yarn Council standard)
  if (t === 'sc' || t === 'single crochet' || t === 'single crochets') return 'sc';
  if (t === 'hdc' || t === 'half double crochet' || t === 'half double') return 'hdc';
  if (t === 'dc' || t === 'double crochet' || t === 'double crochets') return 'dc';
  if (t === 'tr' || t === 'trc' || t === 'treble' || t === 'triple crochet') return 'tr';
  return null;
}

function classifyMilestoneLine(trimmed: string): MilestoneAnnotation['kind'] | null {
  const lower = trimmed.toLowerCase();
  if (/^(embroider|stitch\s+details|add\s+eyes|attach\s+safety\s+eyes|sew\s+face)\b/.test(lower)) {
    return 'embroider';
  }
  if (/^(glue|hot\s+glue|fabric\s+glue)\b/.test(lower)) {
    return 'glue';
  }
  if (/^(stuff|add\s+stuffing|polyfill|lightly\s+stuff|firmly\s+stuff)\b/.test(lower)) {
    return 'stuff';
  }
  if (/^(fasten\s+off|fo\b|cut\s+yarn|weave\s+in|finish\s+off|tie\s+off)\b/.test(lower)) {
    return 'fasten_off';
  }
  if (
    /^(?:note|assembly|tip)\s*:/i.test(lower) ||
    /^(?:close\s+off|close\s+and\s+sew|sew\s+the|hide\s+the\s+tail|all\s+that['’]s\s+left|for\s+the\s+second\s+leg|the\s+little\s+belly|the\s+belt\s+is\s+sewn)\b/i.test(
      lower,
    )
  ) {
    return 'note';
  }
  return null;
}

/**
 * Splits a row body by commas or semicolons only at top-level (not inside (...) or [...] or *...*).
 */
function splitTopLevelClauses(input: string): Array<{ text: string; offset: number }> {
  const results: Array<{ text: string; offset: number }> = [];
  let depthParen = 0;
  let depthBracket = 0;
  let inStar = false;
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(') depthParen++;
    else if (ch === ')' && depthParen > 0) depthParen--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']' && depthBracket > 0) depthBracket--;
    else if (ch === '*' && depthParen === 0 && depthBracket === 0) {
      // Check if '*' is multiplication like '] * 6' vs repeat delimiter '*sc, inc*'
      const prevNonSpace = input.slice(0, i).trimEnd().slice(-1);
      if (prevNonSpace !== ')' && prevNonSpace !== ']') {
        inStar = !inStar;
      }
    }

    const atTop = depthParen === 0 && depthBracket === 0 && !inStar;
    if (atTop && (ch === ',' || ch === ';')) {
      const slice = input.slice(start, i).trim();
      if (slice.length > 0) {
        const leadingWs = input.slice(start, i).search(/\S/);
        results.push({ text: slice, offset: start + (leadingWs >= 0 ? leadingWs : 0) });
      }
      start = i + 1;
    }
  }

  const tail = input.slice(start).trim();
  if (tail.length > 0) {
    const leadingWs = input.slice(start).search(/\S/);
    results.push({ text: tail, offset: start + (leadingWs >= 0 ? leadingWs : 0) });
  }
  return results;
}

/**
 * Extracts trailing stitch-count assertion like "(18)", "(10 sts)", "[24]", "— 8 sts"
 * without stripping repeat groups like "(sc, inc) x 6".
 */
function extractDeclaredCount(body: string): { cleanedBody: string; declaredCount: number | null } {
  const trimmed = body.trimEnd();
  // Case 1: trailing (18) or [18 sts]
  const parenMatch = trimmed.match(/^(.*?)(?:\(\s*(\d+)\s*(?:sts?|stitches)?\s*\)|\[\s*(\d+)\s*(?:sts?|stitches)?\s*\])$/i);
  if (parenMatch) {
    const prefix = parenMatch[1].trimEnd();
    // Make sure prefix doesn't end with 'x' or '*' (e.g. "rep x (6)")
    if (prefix.length > 0 && !/[x×*]$/i.test(prefix)) {
      const countVal = Number(parenMatch[2] ?? parenMatch[3]);
      return { cleanedBody: prefix, declaredCount: countVal };
    }
  }
  // Case 2: trailing "= 18 sts" or "-- 18" or "- 18 sts"
  const dashMatch = trimmed.match(/^(.*?)(?:=|—|--|\s-\s)\s*(\d+)\s*(?:sts?|stitches)?$/i);
  if (dashMatch && dashMatch[1].trim().length > 0) {
    return { cleanedBody: dashMatch[1].trimEnd(), declaredCount: Number(dashMatch[2]) };
  }
  return { cleanedBody: trimmed, declaredCount: null };
}

function parseAssemblyDirective(
  line: string,
  lineNum: number,
  assemblies: AssemblyConstraint[],
  stems: StemSpec[],
  currentPiece: PieceAst | null,
  diagnostics: PatternDiagnostic[]
): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('@')) return false;

  const tokens = trimmed.split(/\s+/);
  const cmd = tokens[0].toLowerCase();

  if (cmd === '@stuffed' && currentPiece) {
    const val = (tokens[1] ?? 'true').toLowerCase();
    currentPiece.stuffedOverride = val !== 'false' && val !== 'off' && val !== '0';
    return true;
  }

  if (cmd === '@color' && currentPiece) {
    const colorRaw = trimmed.slice('@color'.length).trim();
    currentPiece.initialColorHex = resolveYarnColor(colorRaw);
    return true;
  }

  if (cmd === '@place' && currentPiece) {
    const nums = tokens.slice(1).map(Number);
    if (nums.length >= 3 && nums.slice(0, 3).every((n) => !Number.isNaN(n))) {
      currentPiece.defaultOffset = [nums[0], nums[1], nums[2]];
      if (nums.length >= 6 && nums.slice(3, 6).every((n) => !Number.isNaN(n))) {
        currentPiece.defaultRotation = [
          (nums[3] * Math.PI) / 180,
          (nums[4] * Math.PI) / 180,
          (nums[5] * Math.PI) / 180,
        ];
      }
    }
    return true;
  }

  // @stem main_stem (0,-8,0) (0,-3,0.3) (0,1,0) color=forest radius=0.35
  if (cmd === '@stem') {
    const id = tokens[1] ?? `stem_${stems.length + 1}`;
    const ptMatches = [...trimmed.matchAll(/\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g)];
    const points: [number, number, number][] = ptMatches.map((m) => [
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
    ]);
    const colorMatch = trimmed.match(/color=([#a-z0-9_-]+)/i);
    const radiusMatch = trimmed.match(/radius=([\d.]+)/i);
    if (points.length >= 2) {
      stems.push({
        id,
        points,
        colorHex: colorMatch ? resolveYarnColor(colorMatch[1], '#15803D') : '#15803D',
        radius: radiusMatch ? Number(radiusMatch[1]) : 0.32,
      });
    } else {
      diagnostics.push({
        severity: 'warning',
        line: lineNum,
        message: '@stem requires at least two (x,y,z) points.',
      });
    }
    return true;
  }

  // @coil rose_strip pitch=0.35 radius=0.45 stem=main_stem
  if (cmd === '@coil') {
    const targetPiece = tokens[1] ?? currentPiece?.id ?? 'piece';
    const pitchMatch = trimmed.match(/pitch=([-\d.]+)/i);
    const radiusMatch = trimmed.match(/radius=([-\d.]+)/i);
    const stemMatch = trimmed.match(/stem=([a-z0-9_-]+)/i);
    assemblies.push({
      kind: 'coil',
      pieceId: targetPiece.toLowerCase(),
      edgeStitches: [], // Populated by compiler with Row 1 / foundation stitches
      pitch: pitchMatch ? Number(pitchMatch[1]) : 0.32,
      innerRadius: radiusMatch ? Number(radiusMatch[1]) : 0.45,
      stemId: stemMatch ? stemMatch[1] : undefined,
    });
    return true;
  }

  // @glue childPiece -> stem main_stem t=0.85 angle=90 tilt=35
  // @attach ear_left -> head round=5 stitches=3..6 offset=0.2
  if (cmd === '@glue' || cmd === '@attach') {
    const kind = cmd === '@glue' ? 'glue' : 'attach';
    const arrowParts = trimmed.slice(cmd.length).split('->');
    if (arrowParts.length === 2) {
      const childPiece = arrowParts[0].trim().toLowerCase();
      const rhs = arrowParts[1].trim();
      if (/^stem\b/i.test(rhs)) {
        const rhsTokens = rhs.split(/\s+/);
        const stemId = rhsTokens[1] ?? 'stem_1';
        const tMatch = rhs.match(/\bt=([-\d.]+)/i);
        const angleMatch = rhs.match(/\bangle=([-\d.]+)/i);
        const tiltMatch = rhs.match(/\btilt=([-\d.]+)/i);
        assemblies.push({
          kind,
          childPiece,
          childStitches: [],
          hostTarget: {
            kind: 'stem',
            stemId,
            t: tMatch ? Number(tMatch[1]) : 1.0,
            angleRad: angleMatch ? (Number(angleMatch[1]) * Math.PI) / 180 : 0,
            tiltRad: tiltMatch ? (Number(tiltMatch[1]) * Math.PI) / 180 : 0,
          },
        });
        return true;
      } else {
        const rhsTokens = rhs.split(/\s+/);
        const hostPiece = (rhsTokens[0] ?? 'head').toLowerCase();
        const rndMatch = rhs.match(/\b(?:round|rnd|row)=(\d+)/i);
        const stRangeMatch = rhs.match(/\b(?:stitches|sts)=(\d+)(?:\.\.(\d+))?/i);
        const offsetMatch = rhs.match(/\boffset=([-\d.]+)/i);
        const startSt = stRangeMatch ? Number(stRangeMatch[1]) : 0;
        const endSt = stRangeMatch && stRangeMatch[2] ? Number(stRangeMatch[2]) : startSt + 2;
        assemblies.push({
          kind,
          childPiece,
          childStitches: [],
          hostTarget: {
            kind: 'surface',
            hostPiece,
            round: rndMatch ? Number(rndMatch[1]) : 1,
            startStitch: startSt,
            endStitch: endSt,
            offsetNormal: offsetMatch ? Number(offsetMatch[1]) : 0.15,
          },
        });
        return true;
      }
    }
    return true;
  }

  // @seam pieceA 0..5 -> pieceB 0..5
  if (cmd === '@seam') {
    const m = trimmed.match(/^@seam\s+([a-z0-9_]+)\s+(\d+)\.\.(\d+)\s*->\s*([a-z0-9_]+)\s+(\d+)\.\.(\d+)/i);
    if (m) {
      const expandRange = (a: number, b: number) => {
        const arr: number[] = [];
        const step = a <= b ? 1 : -1;
        for (let k = a; step > 0 ? k <= b : k >= b; k += step) arr.push(k);
        return arr;
      };
      assemblies.push({
        kind: 'seam',
        pieceA: m[1].toLowerCase(),
        stitchesA: expandRange(Number(m[2]), Number(m[3])),
        pieceB: m[4].toLowerCase(),
        stitchesB: expandRange(Number(m[5]), Number(m[6])),
      });
    }
    return true;
  }

  return false;
}

function parseTargetSuffix(
  clause: string
): { core: string; target: TargetMode; siteOverride?: AttachmentSite } {
  let working = clause.trim();
  let siteOverride: AttachmentSite | undefined;

  // Detect BLO / FLO / PHT / PHD / front loop / back loop suffix or prefix
  if (/\bin\s+(?:the\s+)?back\s+loops?\s+only\b|\bin\s+(?:blo|pht)\b|\bpor\s+hebra\s+trasera\b/i.test(working)) {
    siteOverride = 'blo';
    working = working
      .replace(/\bin\s+(?:the\s+)?back\s+loops?\s+only\b|\bin\s+(?:blo|pht)\b|\bpor\s+hebra\s+trasera\b/gi, '')
      .trim();
  } else if (
    /\bin\s+(?:the\s+)?front\s+loops?\s+only\b|\bin\s+(?:flo|phd)\b|\bpor\s+hebra\s+delantera\b/i.test(
      working
    )
  ) {
    siteOverride = 'flo';
    working = working
      .replace(
        /\bin\s+(?:the\s+)?front\s+loops?\s+only\b|\bin\s+(?:flo|phd)\b|\bpor\s+hebra\s+delantera\b/gi,
        ''
      )
      .trim();
  }

  // Magic ring (English & Spanish)
  if (
    /\bin\s+(?:a\s+)?(?:magic\s+ring|magic\s+circle|mr|mc|ring)\b|\ben\s+(?:un\s+)?(?:anillo\s+m[aá]gico|am)\b/i.test(
      working
    )
  ) {
    const core = working
      .replace(
        /\bin\s+(?:a\s+)?(?:magic\s+ring|magic\s+circle|mr|mc|ring)\b|\ben\s+(?:un\s+)?(?:anillo\s+m[aá]gico|am)\b/gi,
        ''
      )
      .trim();
    return { core, target: { kind: 'magic_ring' }, siteOverride };
  }

  // From hook: "in 2nd ch from hook", "Starting in 2nd chain from hook: inc", "28 sc starting in 2nd chain from hook"
  const ordMap: Record<string, number> = {
    '1st': 1,
    first: 1,
    '2nd': 2,
    second: 2,
    '3rd': 3,
    third: 3,
    '4th': 4,
    fourth: 4,
    '5th': 5,
    fifth: 5,
  };
  const fromHookRegex =
    /(?:starting\s+)?\bin\s+(?:the\s+)?(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth)\s+(?:ch|chain|cad|cadena)\s+from\s+(?:the\s+)?hook\s*:?\s*/i;
  const fromHookMatch = working.match(fromHookRegex);
  if (fromHookMatch) {
    const rawOrd = fromHookMatch[1].toLowerCase();
    const offset = ordMap[rawOrd] ?? parseInt(rawOrd, 10) ?? 2;
    const core = working.replace(fromHookRegex, ' ').trim();
    return { core, target: { kind: 'from_hook', offset }, siteOverride };
  }

  // Chain space: "in next ch-2 sp", "in ch-sp", "in corner sp", "in ch-1 space"
  const chSpMatch = working.match(
    /\bin\s+(?:the\s+)?(?:next\s+|same\s+)?(?:corner\s+)?(?:ch(?:ain)?(?:-\d+)?\s*(?:sp|space)|corner\s+space|arch)\b/i
  );
  if (chSpMatch) {
    const core = working.slice(0, chSpMatch.index).trim();
    return { core, target: { kind: 'chain_space' }, siteOverride };
  }

  // "in next N sts / chs" -> expands count if core didn't specify a count!
  const inNextCountMatch = working.match(
    /\bin\s+(?:the\s+)?next\s+(\d+)\s*(?:sts?|stitches|chs?|chains)\b/i
  );
  if (inNextCountMatch) {
    const n = Number(inNextCountMatch[1]);
    const core = working.slice(0, inNextCountMatch.index).trim();
    // Prepend count if core has no number
    const hasCount = /^\d+/.test(core);
    return {
      core: hasCount ? core : `${n} ${core}`,
      target: { kind: 'next_each' },
      siteOverride,
    };
  }

  // Same / single stitch fan: "in same st", "in last ch", "in first st", "in the sc stitch", "in the last single crochet stitch", "in the next"
  const inSingleMatch = working.match(
    /\bin\s+(?:the\s+)?(?:same|last|first|next|sc|single\s+crochet|last\s+single\s+crochet)\s*(?:st|stitch|ch|chain)?\b/i
  );
  if (inSingleMatch) {
    const whichWord = inSingleMatch[0].toLowerCase();
    const core = working.slice(0, inSingleMatch.index).trim();
    const leadingNum = core.match(/^(\d+)\b/);
    const isMulti = leadingNum && Number(leadingNum[1]) > 1;
    if (isMulti || /same|last|sc|single/.test(whichWord)) {
      return { core, target: { kind: 'same_stitch' }, siteOverride };
    }
    return { core, target: { kind: 'next_each' }, siteOverride };
  }

  // "in each st around / across / to end" or trailing "around / across"
  const aroundMatch = working.match(
    /\b(?:in\s+each\s+(?:st|stitch|ch|chain)\s+(?:around|across|to\s+end)|(?:in\s+each\s+(?:st|stitch))|(?:around|across))$/i
  );
  if (aroundMatch) {
    const core = working.slice(0, aroundMatch.index).trim();
    if (core.length > 0 && !/^\d+/.test(core)) {
      return { core, target: { kind: 'all_remaining' }, siteOverride };
    }
    if (core.length > 0) {
      return { core, target: { kind: 'next_each' }, siteOverride };
    }
  }

  return { core: working, target: { kind: 'next_each' }, siteOverride };
}

function parseStatementList(
  rawBody: string,
  lineNum: number,
  baseColOffset: number,
  dialect: CrochetDialect,
  diagnostics: PatternDiagnostic[]
): StatementNode[] {
  const statements: StatementNode[] = [];
  const clauses = splitTopLevelClauses(rawBody);

  for (const clauseObj of clauses) {
    // Also split "ch 1 and turn" or "border around and do 2 sc at the corners" carefully:
    // First check full-clause special forms BEFORE splitting on " and "!
    const rawClause = clauseObj.text.trim();
    const span: SourceSpan = {
      line: lineNum,
      colStart: baseColOffset + clauseObj.offset + 1,
      colEnd: baseColOffset + clauseObj.offset + rawClause.length + 1,
    };

    // 1. Border around clause! e.g. "sc a border around and do 2 sc at the corners"
    if (/\bborder\s+around\b/i.test(rawClause)) {
      const cornerMatch = rawClause.match(/(\d+)\s*(?:sc|hdc|dc)?\s*(?:at|in)\s+(?:the\s+|each\s+)?corners?/i);
      const cornerCount = cornerMatch ? Number(cornerMatch[1]) : 2;
      let borderStitch: StitchKind = 'sc';
      if (/\bhdc\b/i.test(rawClause)) borderStitch = 'hdc';
      else if (/\bdc\b/i.test(rawClause)) borderStitch = 'dc';
      else if (/\bsl\s*st\b/i.test(rawClause)) borderStitch = 'sl_st';
      statements.push({
        type: 'border_op',
        stitch: borderStitch,
        cornerCount,
        span,
      });
      continue;
    }

    // 2. Opposite side of foundation chain (3D Oval pivot!)
    if (
      /\b(?:opposite|other|under)\s*side\s+of\s+(?:the\s+)?(?:foundation\s+)?(?:ch|chain)\b|\bunderside\s+of\s+(?:ch|chain)\b/i.test(
        rawClause
      )
    ) {
      statements.push({ type: 'opposite_side_op', span });
      // Check if there is an instruction right after a colon inside the same clause
      const afterChain = rawClause.replace(
        /^.*?\b(?:opposite|other|under)\s*side\s+of\s+(?:the\s+)?(?:foundation\s+)?(?:ch|chain)\s*:?\s*/i,
        ''
      );
      if (afterChain && afterChain !== rawClause) {
        statements.push(
          ...parseStatementList(afterChain, lineNum, span.colStart, dialect, diagnostics)
        );
      }
      continue;
    }

    // 2.5 Leading Loop-Mode or Color Prefix before groups/clauses (e.g. "BLO [sc, dec] x 3", "FLO: (sc, inc) x 4", "PHT: (pb, dism) x 4")
    const loopPrefixMatch = rawClause.match(
      /^(?:in\s+)?(?:(blo|pht|back\s+loops?\s+only|por\s+hebra\s+trasera)|(flo|phd|front\s+loops?\s+only|por\s+hebra\s+delantera))[\s:]+(.+)$/i
    );
    if (loopPrefixMatch) {
      const site: AttachmentSite = loopPrefixMatch[1] ? 'blo' : 'flo';
      const rest = loopPrefixMatch[3].trim();
      statements.push({ type: 'loop_mode_op', site, span });
      statements.push(...parseStatementList(rest, lineNum, span.colStart, dialect, diagnostics));
      continue;
    }

    const ccGroupPrefixMatch = rawClause.match(
      /^(?:cc\s*:?\s*(?:to\s+)?|change\s+(?:colou?r\s+)?to\s+|switch\s+to\s+|colou?r\s*:\s*)([#a-z0-9\s_-]+?)\s*:\s*(.+)$/i
    );
    if (ccGroupPrefixMatch) {
      const resolved = resolveYarnColor(ccGroupPrefixMatch[1], '');
      if (resolved) {
        statements.push({
          type: 'color_op',
          colorHex: resolved,
          colorName: ccGroupPrefixMatch[1],
          span,
        });
        statements.push(
          ...parseStatementList(ccGroupPrefixMatch[2], lineNum, span.colStart, dialect, diagnostics)
        );
        continue;
      }
    }

    // 3. Bracket or Parenthesis Repeat Group: "[sc, inc] x 6", "(2 sc, dec) 6 times", "(3 dc, ch 2, 3 dc) in next ch-2 sp"
    const groupMatch = rawClause.match(
      /^(?:\[([^\]]+)\]|\(([^)]+)\))\s*(.*)$/i
    );
    if (groupMatch) {
      const innerText = (groupMatch[1] ?? groupMatch[2]).trim();
      const suffix = groupMatch[3].trim();

      // Check if `[tan]` or `[color: brown]` is actually an inline color switch!
      if (groupMatch[1] && suffix === '' && !innerText.includes(',')) {
        const cleanColor = innerText.replace(/^color\s*:\s*|^with\s+/i, '').trim();
        const resolved = resolveYarnColor(cleanColor, '');
        if (resolved) {
          statements.push({
            type: 'color_op',
            colorHex: resolved,
            colorName: cleanColor,
            span,
          });
          continue;
        }
      }
      // Or `[tan] 6 sc` (inline color tag immediately followed by stitch op!)
      if (groupMatch[1] && !innerText.includes(',') && !/^(?:x|\*|\d+\s*times|around|across|in\b)/i.test(suffix)) {
        const cleanColor = innerText.replace(/^color\s*:\s*|^with\s+/i, '').trim();
        const resolved = resolveYarnColor(cleanColor, '');
        if (resolved && suffix.length > 0) {
          statements.push({
            type: 'color_op',
            colorHex: resolved,
            colorName: cleanColor,
            span,
          });
          statements.push(
            ...parseStatementList(suffix, lineNum, span.colStart, dialect, diagnostics)
          );
          continue;
        }
      }

      const innerBody = parseStatementList(innerText, lineNum, span.colStart + 1, dialect, diagnostics);
      let times: number | 'around_or_end' = 1;
      let leaveUnworked = 0;
      let sharedTarget: TargetMode | undefined;

      const multMatch = suffix.match(/^(?:[x×*]\s*(\d+)|(\d+)\s*times?\b|rep(?:eat)?\s*(\d+)\s*times?\b)/i);
      if (multMatch) {
        times = Number(multMatch[1] ?? multMatch[2] ?? multMatch[3]);
      } else if (/\b(?:around|across|to\s+end|to\s+last)\b/i.test(suffix)) {
        times = 'around_or_end';
        const lastMatch = suffix.match(/to\s+last\s+(\d+)/i);
        if (lastMatch) leaveUnworked = Number(lastMatch[1]);
      } else if (/^\d+$/.test(suffix)) {
        times = Number(suffix);
      } else if (/^in\s+/i.test(suffix)) {
        const parsedTarget = parseTargetSuffix(`sc ${suffix}`);
        sharedTarget = parsedTarget.target;
      } else if (suffix === '' && clauses.length === 1 && innerBody.length >= 2) {
        // e.g. "11. (3 sc, dec) (12)" where the author omitted "x 3" on a full-round repeat!
        times = 'around_or_end';
      }

      statements.push({
        type: 'repeat_op',
        body: innerBody,
        times,
        leaveUnworked,
        sharedTarget,
        span,
      });
      continue;
    }

    // 4. Asterisk repeat: "*sc, inc* x 6" or "*dc, ch 1, sk 1; rep from * around"
    const starMatch = rawClause.match(/^\*([^*]+)\*\s*(.*)$/i);
    if (starMatch) {
      const innerText = starMatch[1].trim();
      const suffix = starMatch[2].trim();
      const innerBody = parseStatementList(innerText, lineNum, span.colStart + 1, dialect, diagnostics);
      let times: number | 'around_or_end' = 'around_or_end';
      let leaveUnworked = 0;
      const multMatch = suffix.match(/(?:[x×*]\s*(\d+)|(\d+)\s*times?)/i);
      if (multMatch) {
        times = Number(multMatch[1] ?? multMatch[2]);
      } else {
        const lastMatch = suffix.match(/to\s+last\s+(\d+)/i);
        if (lastMatch) leaveUnworked = Number(lastMatch[1]);
      }
      statements.push({
        type: 'repeat_op',
        body: innerBody,
        times,
        leaveUnworked,
        span,
      });
      continue;
    }

    // Split remaining simple connectors like "ch 1 and turn" on " and "
    const subParts = rawClause.split(/\s+and\s+/i);
    for (const subRaw of subParts) {
      let part = subRaw.trim();
      if (!part) continue;

      // Color change prefix: "CC: to grey", "CC: Green", "Change colour to White", "Colour: Golden Brown"
      const ccMatch = part.match(
        /^(?:cc\s*:?\s*(?:to\s+)?|change\s+(?:colou?r\s+)?to\s+|switch\s+to\s+|with\s+colou?r\s+|colou?r\s*:\s*)([#a-z0-9\s_-]+?)(?:[:,]\s*(.*))?$/i
      );
      if (ccMatch) {
        const colorCandidate = ccMatch[1].trim();
        const remainder = ccMatch[2]?.trim();
        const resolved = resolveYarnColor(colorCandidate, '');
        if (resolved) {
          statements.push({
            type: 'color_op',
            colorHex: resolved,
            colorName: colorCandidate,
            span,
          });
          if (remainder) {
            statements.push(
              ...parseStatementList(remainder, lineNum, span.colStart, dialect, diagnostics)
            );
          }
          continue;
        }
      }

      // Turn
      if (/^turn(?:\s+work)?$/i.test(part)) {
        statements.push({ type: 'turn_op', span });
        continue;
      }

      // Fasten off
      if (/^(?:fasten\s+off|fo|finish\s+off|cut\s+yarn)$/i.test(part)) {
        statements.push({ type: 'fasten_off_op', span });
        continue;
      }

      // Join round / ring
      if (/\bjoin\b/i.test(part) && !/\bjoin\s+yarn\b/i.test(part)) {
        const formRing = /\bform\s+(?:a\s+)?ring\b|\bfirst\s+(?:ch|chain)\b/i.test(part);
        statements.push({ type: 'join_op', formFoundationRing: formRing, span });
        continue;
      }

      // Skip stitches: "sk 2", "skip next 2 sts", "sk next ch"
      const skipMatch = part.match(/^(?:sk|skip)(?:\s+(?:the\s+)?next)?(?:\s+(\d+))?\s*(?:sts?|stitches|chs?|chains|sp)?$/i);
      if (skipMatch) {
        statements.push({
          type: 'skip_op',
          count: skipMatch[1] ? Number(skipMatch[1]) : 1,
          span,
        });
        continue;
      }

      // Standalone Magic Ring declaration: "magic ring" or "MR"
      if (/^(?:mr|mc|magic\s+ring|magic\s+circle)$/i.test(part)) {
        statements.push({
          type: 'stitch_op',
          stitch: 'magic_ring',
          count: 1,
          consumePerStitch: 0,
          fanPerParent: 1,
          site: 'ring_center',
          target: { kind: 'magic_ring' },
          span,
        });
        continue;
      }

      // Picot shorthand: "picot" or "ch-3 picot" -> ch 3 + sl_st in base stitch before the ch 3
      const picotMatch = part.match(/^(?:ch-(\d+)\s+)?picot$/i);
      if (picotMatch) {
        const pLen = picotMatch[1] ? Number(picotMatch[1]) : 3;
        statements.push({
          type: 'stitch_op',
          stitch: 'ch',
          count: pLen,
          consumePerStitch: 0,
          fanPerParent: 1,
          site: 'both_loops',
          target: { kind: 'next_each' },
          span,
        });
        statements.push({
          type: 'stitch_op',
          stitch: 'sl_st',
          count: 1,
          consumePerStitch: 0,
          fanPerParent: 1,
          site: 'both_loops',
          target: { kind: 'picot_base', chainLength: pLen },
          span,
        });
        continue;
      }

      // Standalone BLO / FLO / PHT / PHD mode switch for rest of row
      if (/^(?:blo|pht|back\s+loops?\s+only|por\s+hebra\s+trasera)$/i.test(part)) {
        statements.push({ type: 'loop_mode_op', site: 'blo', span });
        continue;
      }
      if (/^(?:flo|phd|front\s+loops?\s+only|por\s+hebra\s+delantera)$/i.test(part)) {
        statements.push({ type: 'loop_mode_op', site: 'flo', span });
        continue;
      }

      // Parse target suffix ("in MR", "in 2nd ch from hook", "in ch-2 sp", "in same st", "around")
      const { core, target, siteOverride } = parseTargetSuffix(part);
      part = core.trim();

      // Prefix loop modifier: "BLO 6 sc", "FLO sc", "PHT 6 pb", "FPdc", "BPdc"
      let site: AttachmentSite = siteOverride ?? 'both_loops';
      if (/^(?:blo|pht|back\s+loop\s+only|por\s+hebra\s+trasera)\s+/i.test(part)) {
        site = 'blo';
        part = part.replace(/^(?:blo|pht|back\s+loop\s+only|por\s+hebra\s+trasera)\s+/i, '').trim();
      } else if (/^(?:flo|phd|front\s+loop\s+only|por\s+hebra\s+delantera)\s+/i.test(part)) {
        site = 'flo';
        part = part.replace(/^(?:flo|phd|front\s+loop\s+only|por\s+hebra\s+delantera)\s+/i, '').trim();
      }

      // Support "<token> x <N>" (e.g. "inc x 2", "dec x 6", "aum x 6", "dism x 6")
      const trailingMultMatch = part.match(/^([a-z\s]+?)\s*[x×*]\s*(\d+)$/i);
      if (trailingMultMatch) {
        part = `${trailingMultMatch[2]} ${trailingMultMatch[1].trim()}`;
      }

      // Support prose like "Make 12 sc in each leg for a total of 24 sc" -> extract total "24 sc"
      const totalOfMatch = part.match(/\btotal\s+of\s+(\d+\s*[a-z]+)/i);
      if (totalOfMatch) {
        part = totalOfMatch[1].trim();
      }

      // Normalize spaceless count+token like "4sc", "2inc", "6dec", "3fpdc", "12ch"
      const countPrefixMatch = part.match(/^(\d+)\s*([a-z].*)$/i);
      let explicitCount: number | null = null;
      let tokenPart = part;
      if (countPrefixMatch) {
        // Watch out for "3-dc bobble" or "3-dc cluster" where "3-dc" describes the cluster!
        if (!/^(\d+)-(?:dc|hdc|tr)\s+(?:cluster|bobble|puff|popcorn)/i.test(part)) {
          explicitCount = Number(countPrefixMatch[1]);
          tokenPart = countPrefixMatch[2].trim();
        }
      }

      // Also support "ch 10", "Chain 7", "cad 7" where count comes AFTER stitch name!
      const stitchFirstCountMatch = tokenPart.match(
        /^(ch|chain|cad|cadenas|sc|pb|hdc|pma|dc|pa|tr|inc|aum|dec|dism)\s+(\d+)$/i
      );
      if (stitchFirstCountMatch && explicitCount === null) {
        tokenPart = stitchFirstCountMatch[1];
        explicitCount = Number(stitchFirstCountMatch[2]);
      }

      // Post-stitch prefix check on tokenPart: "FPdc", "BPsc", "front post dc", "back post hdc"
      if (/^(?:fp|front\s+post\s*)/i.test(tokenPart)) {
        site = 'front_post';
        tokenPart = tokenPart.replace(/^(?:fp|front\s+post\s*)/i, '').trim();
      } else if (/^(?:bp|back\s+post\s*)/i.test(tokenPart)) {
        site = 'back_post';
        tokenPart = tokenPart.replace(/^(?:bp|back\s+post\s*)/i, '').trim();
      }

      // Increases: "inc", "Increase", "sc inc", "aum", "aumento"
      const incMatch = tokenPart.match(
        /^(?:(sc|pb|hdc|pma|dc|pa|tr)\s+)?(?:inc(?:rease)?s?|aum(?:ento)?s?)$/i
      );
      if (incMatch) {
        const baseKind = incMatch[1] ? (mapStitchKind(incMatch[1], dialect) ?? 'sc') : 'sc';
        statements.push({
          type: 'stitch_op',
          stitch: baseKind,
          count: explicitCount ?? 1, // Number of increases to perform!
          consumePerStitch: 1,
          fanPerParent: 2,
          site: target.kind === 'chain_space' ? 'chain_space' : site,
          target,
          span,
        });
        continue;
      }

      // Decreases: "dec", "invdec", "sc2tog", "dism", "disminución"
      const togMatch = tokenPart.match(/^(sc|pb|hdc|pma|dc|pa|tr)(\d+)tog$/i);
      if (
        togMatch ||
        /^(?:(?:inv|invisible|sc|pb|hdc|pma|dc|pa)?\s*(?:dec(?:rease)?s?|dism(?:inuci[oó]n)?(?:es)?))$/i.test(
          tokenPart
        )
      ) {
        let baseKind: StitchKind = 'sc';
        let together = 2;
        if (togMatch) {
          baseKind = mapStitchKind(togMatch[1], dialect) ?? 'sc';
          together = Math.max(2, Number(togMatch[2]));
        } else {
          const prefixKind = tokenPart.match(/^(sc|hdc|dc)/i);
          if (prefixKind) baseKind = mapStitchKind(prefixKind[1], dialect) ?? 'sc';
        }
        statements.push({
          type: 'stitch_op',
          stitch: baseKind,
          count: explicitCount ?? 1,
          consumePerStitch: together,
          fanPerParent: 1,
          site,
          target,
          span,
        });
        continue;
      }

      // Named textured clusters: "3-dc cluster", "5-dc bobble", "puff", "popcorn"
      const clusterMatch = tokenPart.match(/^(?:\d+-(?:dc|hdc|tr)\s+)?(cluster|bobble|puff|popcorn)s?$/i);
      if (clusterMatch) {
        const kind = mapStitchKind(clusterMatch[1], dialect) ?? 'bobble';
        statements.push({
          type: 'stitch_op',
          stitch: kind,
          count: explicitCount ?? 1,
          consumePerStitch: 1,
          fanPerParent: 1,
          site: target.kind === 'chain_space' ? 'chain_space' : site,
          target,
          span,
        });
        continue;
      }

      // V-stitch shorthand: "V-st" or "v-stitch" -> (dc, ch 1, dc) in same st
      if (/^v-?st(?:itch)?$/i.test(tokenPart)) {
        statements.push({
          type: 'repeat_op',
          times: explicitCount ?? 1,
          leaveUnworked: 0,
          sharedTarget: { kind: 'same_stitch' },
          body: [
            {
              type: 'stitch_op',
              stitch: 'dc',
              count: 1,
              consumePerStitch: 1,
              fanPerParent: 1,
              site,
              target: { kind: 'same_stitch' },
              span,
            },
            {
              type: 'stitch_op',
              stitch: 'ch',
              count: 1,
              consumePerStitch: 0,
              fanPerParent: 1,
              site: 'both_loops',
              target: { kind: 'next_each' },
              span,
            },
            {
              type: 'stitch_op',
              stitch: 'dc',
              count: 1,
              consumePerStitch: 1,
              fanPerParent: 1,
              site,
              target: { kind: 'same_stitch' },
              span,
            },
          ],
          span,
        });
        continue;
      }

      // Standard stitches: ch, sl st, sc, hdc, dc, tr
      const mapped = mapStitchKind(tokenPart, dialect);
      if (mapped) {
        const finalSite: AttachmentSite =
          target.kind === 'magic_ring'
            ? 'ring_center'
            : target.kind === 'chain_space'
              ? 'chain_space'
              : site;
        statements.push({
          type: 'stitch_op',
          stitch: mapped,
          count: explicitCount ?? 1,
          consumePerStitch: mapped === 'ch' || mapped === 'magic_ring' ? 0 : 1,
          fanPerParent: 1,
          site: finalSite,
          target,
          span,
        });
        continue;
      }

      // Unrecognized clause -> emit gentle warning rather than hard-crashing live preview
      diagnostics.push({
        severity: 'warning',
        line: lineNum,
        message: `Unrecognized instruction "${subRaw}" — skipped.`,
        suggestion:
          'Use standard abbreviations like ch, sl st, sc, hdc, dc, tr, inc, dec, BLO, FLO, or [sc, inc] x 6.',
      });
    }
  }

  return statements;
}

const COMPASS_FRACTIONS: Record<string, number> = {
  right: 0.18,
  'front-right': 0.21,
  front: 0.25,
  'front-left': 0.29,
  left: 0.72,
  'top-right': 0.18,
  'top-left': 0.72,
  'back-left': 0.625,
  back: 0.75,
  'back-right': 0.875,
};

function ensureDefaultStem(stems: StemSpec[]): string {
  if (stems.length > 0) return stems[0].id;
  const id = 'main_stem';
  stems.push({
    id,
    points: [
      [0, -9, 0],
      [0, -4, 0.3],
      [0, 0, 0],
    ],
    colorHex: '#15803D',
    radius: 0.32,
  });
  return id;
}

/**
 * Parses natural-language English assembly & bouquet instructions:
 * - "Attach Left Ear to left of Head at Rnd 4"
 * - "Attach Left Ear to Head at Rnd 4, Stitch 5"
 * - "Roll Rose Strip into a flower on Stem"
 * - "Glue Calyx under flower on Stem"
 * - "Glue Leaf to middle of Stem"
 */
function parseNaturalAssemblySentence(
  trimmed: string,
  assemblies: AssemblyConstraint[],
  stems: StemSpec[]
): boolean {
  // 1. "Roll <Piece> into a [flower|spiral|rose|coil] [on Stem]"
  const rollMatch = trimmed.match(
    /^(?:roll|coil|wind)\s+(.+?)\s+into\s+(?:a\s+)?(?:3d\s+)?(?:flower|rose|spiral|coil|bud)(?:\s+(?:on|onto|around)\s+(?:the\s+)?stem)?\.?$/i
  );
  if (rollMatch) {
    const pieceName = rollMatch[1].trim();
    const onStem = /\bstem\b/i.test(trimmed);
    const stemId = onStem ? ensureDefaultStem(stems) : undefined;
    assemblies.push({
      kind: 'coil',
      pieceId: pieceName,
      edgeStitches: [],
      pitch: 0.42,
      innerRadius: 0.45,
      stemId,
    });
    return true;
  }

  // 2. "(Glue|Attach|Pin) <Piece> (under flower | to [the] (top|upper|middle|halfway|lower|bottom) [of]) [on|of] Stem"
  const stemGlueMatch = trimmed.match(
    /^(?:glue|hot\s+glue|fabric\s+glue|attach|pin|sew)\s+(.+?)\s+(?:(under\s+(?:the\s+)?(?:flower|rose|bud))|(?:to|on|at)\s+(?:the\s+)?(top|upper|middle|halfway|center|lower|bottom)(?:\s+of)?)\s+(?:on\s+|of\s+)?(?:the\s+)?stem\.?$/i
  );
  if (stemGlueMatch) {
    const childName = stemGlueMatch[1].trim();
    const isUnderFlower = Boolean(stemGlueMatch[2]);
    const posWord = (stemGlueMatch[3] ?? '').toLowerCase();
    const stemId = ensureDefaultStem(stems);

    let t = 0.52;
    let angleRad = (45 * Math.PI) / 180;
    let tiltRad = 1.1;

    if (isUnderFlower) {
      t = 0.96;
      angleRad = 0;
      tiltRad = Math.PI;
    } else if (posWord === 'top') {
      t = 1.0;
      angleRad = 0;
      tiltRad = 0;
    } else if (posWord === 'upper') {
      t = 0.72;
      angleRad = (25 * Math.PI) / 180;
      tiltRad = 1.1;
    } else if (posWord === 'lower' || posWord === 'bottom') {
      t = 0.28;
      angleRad = (-45 * Math.PI) / 180;
      tiltRad = 1.1;
    }

    assemblies.push({
      kind: 'glue',
      childPiece: childName,
      childStitches: [],
      hostTarget: {
        kind: 'stem',
        stemId,
        t,
        angleRad,
        tiltRad,
      },
    });
    return true;
  }

  // 3. "(Attach|Glue|Pin|Sew) <ChildPiece> to [<compass> [side] of] <HostPiece> [at/on Rnd/Row R] [, Stitch S[-E]]"
  const surfMatch = trimmed.match(
    /^(?:(glue|hot\s+glue|fabric\s+glue)|attach|pin|sew)\s+(.+?)\s+(?:to|onto)\s+(?:the\s+)?(?:(front-left|front-right|back-left|back-right|top-left|top-right|left|right|front|back)(?:\s+side)?\s+of\s+)?(.+?)(?:\s+(?:at|on)\s+(?:rnd|round|row)\s*(\d+))?(?:\s*,?\s*(?:stitch|stitches|st|sts)\s*(\d+)(?:\s*(?:\.\.|-|to)\s*(\d+))?)?\.?$/i
  );
  if (surfMatch) {
    const isGlue = Boolean(surfMatch[1]);
    const childName = surfMatch[2].trim();
    const compassWord = surfMatch[3]?.toLowerCase();
    const hostName = surfMatch[4].trim();
    const rndStr = surfMatch[5];
    const stStartStr = surfMatch[6];
    const stEndStr = surfMatch[7];

    // Require at least one concrete placement specifier (compass side, round number, or stitch number)
    // so general prose like "Glue or sew sword and shield props onto character" stays a milestone note!
    if (!compassWord && !rndStr && !stStartStr) {
      return false;
    }

    const round = rndStr ? Number(rndStr) : 4;
    const startSt = stStartStr ? Math.max(0, Number(stStartStr) - 1) : 0;
    const endSt = stEndStr
      ? Math.max(startSt, Number(stEndStr) - 1)
      : stStartStr
        ? startSt + 1
        : 2;
    const compassFraction =
      compassWord && stStartStr === undefined ? COMPASS_FRACTIONS[compassWord] : undefined;

    assemblies.push({
      kind: isGlue ? 'glue' : 'attach',
      childPiece: childName,
      childStitches: [],
      hostTarget: {
        kind: 'surface',
        hostPiece: hostName,
        round,
        startStitch: startSt,
        endStitch: endSt,
        compassFraction,
        offsetNormal: 0.25,
      },
    });
    return true;
  }

  return false;
}

export function parsePattern(rawText: string, options: ParseOptions = {}): PatternAst {
  const dialect: CrochetDialect = options.dialect ?? 'US';
  const diagnostics: PatternDiagnostic[] = [];
  const pieces: PieceAst[] = [];
  const assemblies: AssemblyConstraint[] = [];
  const stems: StemSpec[] = [];
  const usedPieceIds = new Set<string>();

  const ensurePiece = (lineNum: number, name = 'Main Piece', colorHex?: string): PieceAst => {
    if (pieces.length === 0) {
      const id = slugifyPieceId(name, usedPieceIds);
      const p: PieceAst = {
        id,
        name,
        initialColorHex: colorHex ?? DEFAULT_PIECE_PALETTE[0],
        rows: [],
        annotations: [],
        sourceLine: lineNum,
      };
      pieces.push(p);
      return p;
    }
    return pieces[pieces.length - 1];
  };

  const lines = rawText.replace(/\r\n/g, '\n').split('\n');

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    // Strip trailing inline comments ("// ..." or " # comment" that isn't a #hex color code)
    const rawLine = lines[idx]
      .replace(/\s+\/\/.*$/, '')
      .replace(/\s+#(?![0-9a-f]{3,6}\b).*$/i, '');
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      continue;
    }

    // 1. Assembly / Metadata directives (@glue, @attach, @coil, @stem, @seam, @place, @stuffed, @color)
    if (trimmed.startsWith('@')) {
      const activePiece = pieces.length > 0 ? pieces[pieces.length - 1] : null;
      if (parseAssemblyDirective(trimmed, lineNum, assemblies, stems, activePiece, diagnostics)) {
        continue;
      }
    }

    // 1.5 Plain-English Assembly & Bouquet sentences ("Attach Left Ear to left of Head at Rnd 4", "Roll Rose Strip into a flower on Stem")
    if (parseNaturalAssemblySentence(trimmed, assemblies, stems)) {
      continue;
    }

    // 2. Milestone craft prose lines ("Embroider...", "Glue...", "Stuff firmly...", "Fasten off...")
    const milestoneKind = classifyMilestoneLine(trimmed);
    if (milestoneKind) {
      const piece = ensurePiece(lineNum);
      piece.annotations.push({
        pieceId: piece.id,
        kind: milestoneKind,
        text: trimmed,
        sourceLine: lineNum,
        afterRowIndex: piece.rows.length - 1,
      });
      continue;
    }

    // 3. Explicit Piece Section Headers:
    //    "=== Shield ===" or "Sword:" or "Head [tan]:" or "Ear (make 2):"
    //    Must NOT match "Row 1:", "Rnd 2:", "R3:", "CC:"!
    const bannerMatch = trimmed.match(/^={2,}\s*(?:piece\s*:\s*)?(.+?)\s*={2,}$/i);
    const colonHeaderMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9\s()'_-]{1,40})(?:\[([^\]]+)\])?\s*:\s*$/);
    if (bannerMatch || colonHeaderMatch) {
      const rawTitle = (bannerMatch ? bannerMatch[1] : colonHeaderMatch![1]).trim();
      if (!/^(?:row|rnd|round|r\d+|cc|color|note|tip|border|edging)$/i.test(rawTitle)) {
        const bracketColor = colonHeaderMatch?.[2]
          ? resolveYarnColor(colonHeaderMatch[2], '')
          : undefined;
        // Also check if banner has [color]
        const inlineBannerColorMatch = rawTitle.match(/\[([^\]]+)\]/);
        const cleanedTitle = rawTitle.replace(/\[[^\]]+\]/g, '').trim();
        const colorHex =
          bracketColor ||
          (inlineBannerColorMatch ? resolveYarnColor(inlineBannerColorMatch[1], '') : '') ||
          DEFAULT_PIECE_PALETTE[pieces.length % DEFAULT_PIECE_PALETTE.length];

        const id = slugifyPieceId(cleanedTitle, usedPieceIds);
        pieces.push({
          id,
          name: cleanedTitle,
          initialColorHex: colorHex,
          rows: [],
          annotations: [],
          sourceLine: lineNum,
        });
        continue;
      }
    }

    // 4. Standalone Colour / CC: / Border: lines without a row number!
    //    e.g. "Colour: Golden Brown", "Change colour to White", "CC: to grey, sc a border around and do 2 sc at the corners"
    const standaloneColorMatch = trimmed.match(
      /^(?:colou?r\s*:\s*|change\s+colou?r\s+to\s+|cc\s*:\s*(?:to\s+)?)([#a-z0-9\s_-]+)$/i
    );
    if (standaloneColorMatch) {
      const resolved = resolveYarnColor(standaloneColorMatch[1].trim(), '');
      if (resolved) {
        const piece = ensurePiece(lineNum);
        if (piece.rows.length === 0) {
          piece.initialColorHex = resolved;
        } else {
          piece.rows.push({
            rowNumber: piece.rows[piece.rows.length - 1].rowNumber,
            explicitModeHint: 'auto',
            declaredCount: null,
            statements: [
              {
                type: 'color_op',
                colorHex: resolved,
                colorName: standaloneColorMatch[1].trim(),
                span: { line: lineNum, colStart: 1, colEnd: trimmed.length + 1 },
              },
            ],
            sourceLine: lineNum,
            rawHeader: 'Color Change',
          });
        }
        continue;
      }
    }

    if (/^(?:cc|border|edging)\s*:/i.test(trimmed)) {
      const piece = ensurePiece(lineNum);
      const nextRowNum =
        piece.rows.length > 0 ? piece.rows[piece.rows.length - 1].rowNumber + 1 : 1;
      const isBorderHeader = /^(?:border|edging)\s*:/i.test(trimmed);
      const bodyStr = isBorderHeader ? trimmed.replace(/^(?:border|edging)\s*:\s*/i, '') : trimmed;
      const { cleanedBody, declaredCount } = extractDeclaredCount(bodyStr);
      const statements = parseStatementList(cleanedBody, lineNum, 0, dialect, diagnostics);
      if (statements.length > 0) {
        piece.rows.push({
          rowNumber: nextRowNum,
          explicitModeHint: 'auto',
          declaredCount,
          statements,
          sourceLine: lineNum,
          rawHeader: isBorderHeader ? 'Border' : `Row ${nextRowNum}`,
        });
      }
      continue;
    }

    // 5. Row / Round / Auto-Numbered Lines:
    //    Examples:
    //    - "Rnd 1: 6 sc in MR (6)"
    //    - "Rnds 5-8: 24 sc (24)"
    //    - "Row 3 [RS]: ch 1, turn, sc across (10)"
    //    - "3. Chain, turn, 2 inc (4)"
    //    - "Foundation: ch 11"
    const rowHeaderMatch = trimmed.match(
      /^(?:(foundation)\s*[:.-]|(rnds?|rounds?|rows?|r)\s*(\d+)(?:\s*[-–—to]+\s*(\d+))?(?:\s*\([^)]*\))?(?:\s*\[(RS|WS)\])?\s*[:.-]|(\d+)(?:\s*[-–—]\s*(\d+))?\s*[.):-])\s*(.+)$/i
    );

    if (rowHeaderMatch) {
      const piece = ensurePiece(lineNum);
      const isFoundation = Boolean(rowHeaderMatch[1]);
      const keyword = (rowHeaderMatch[2] ?? '').toLowerCase();
      const startNum = isFoundation
        ? 0
        : Number(rowHeaderMatch[3] ?? rowHeaderMatch[6] ?? piece.rows.length + 1);
      const endNum = isFoundation
        ? 0
        : Number(rowHeaderMatch[4] ?? rowHeaderMatch[7] ?? startNum);
      const sideHint = rowHeaderMatch[5]?.toUpperCase() as 'RS' | 'WS' | undefined;
      const rawBodyPart = rowHeaderMatch[8];

      let explicitModeHint: 'row' | 'round' | 'auto' = 'auto';
      if (keyword.startsWith('rnd') || keyword.startsWith('round')) {
        explicitModeHint = 'round';
      } else if (keyword.startsWith('row')) {
        explicitModeHint = 'row';
      }

      const bodyOffset = rawLine.indexOf(rawBodyPart);
      const { cleanedBody, declaredCount } = extractDeclaredCount(rawBodyPart);
      const statements = parseStatementList(
        cleanedBody,
        lineNum,
        Math.max(0, bodyOffset),
        dialect,
        diagnostics
      );

      const safeEnd = Math.min(endNum, startNum + 60); // Guard against typo like Rnds 1-99999
      for (let r = startNum; r <= safeEnd; r++) {
        // Deep-clone statements so each expanded row is clean
        piece.rows.push({
          rowNumber: r,
          explicitModeHint,
          sideHint: r === startNum ? sideHint : undefined,
          declaredCount,
          statements: structuredClone(statements),
          sourceLine: lineNum,
          rawHeader:
            explicitModeHint === 'round'
              ? `Rnd ${r}`
              : explicitModeHint === 'row'
                ? `Row ${r}`
                : `${r}`,
        });
      }
      continue;
    }

    // 6. Fallback: any unrecognized line beginning (no row/round number, no header colon, no color/border/directive)
    //    is treated as a freeform comment/note so pattern authors can write natural prose notes anywhere without syntax prefixes.
    const piece = ensurePiece(lineNum);
    piece.annotations.push({
      pieceId: piece.id,
      kind: 'note',
      text: trimmed,
      sourceLine: lineNum,
      afterRowIndex: piece.rows.length - 1,
    });
  }

  return {
    pieces,
    assemblies,
    stems,
    diagnostics,
  };
}
