import { CrochetDialect } from '../model/types';

export const DIALECT_LABELS: Record<CrochetDialect, string> = {
  US: 'US Terms (sc / dc)',
  UK: 'UK Terms (dc / tr)',
  ES: 'ES Terms (pb / pa / aum)',
};

type CanonicalOp =
  | 'ch'
  | 'sl_st'
  | 'sc'
  | 'hdc'
  | 'dc'
  | 'tr'
  | 'inc'
  | 'dec'
  | 'blo'
  | 'flo'
  | 'turn'
  | 'join'
  | 'sk'
  | 'mr_phrase'
  | 'from_hook_phrase';

const TARGET_STRINGS: Record<CrochetDialect, Record<CanonicalOp, string>> = {
  US: {
    ch: 'ch',
    sl_st: 'sl st',
    sc: 'sc',
    hdc: 'hdc',
    dc: 'dc',
    tr: 'tr',
    inc: 'inc',
    dec: 'dec',
    blo: 'BLO',
    flo: 'FLO',
    turn: 'turn',
    join: 'join',
    sk: 'sk',
    mr_phrase: 'in a magic ring',
    from_hook_phrase: 'in 2nd ch from hook',
  },
  UK: {
    ch: 'ch',
    sl_st: 'sl st',
    sc: 'dc',
    hdc: 'htr',
    dc: 'tr',
    tr: 'dtr',
    inc: 'inc',
    dec: 'dec',
    blo: 'BLO',
    flo: 'FLO',
    turn: 'turn',
    join: 'join',
    sk: 'sk',
    mr_phrase: 'in a magic ring',
    from_hook_phrase: 'in 2nd ch from hook',
  },
  ES: {
    ch: 'cad',
    sl_st: 'pd',
    sc: 'pb',
    hdc: 'pma',
    dc: 'pa',
    tr: 'pad',
    inc: 'aum',
    dec: 'dism',
    blo: 'PHT',
    flo: 'PHD',
    turn: 'girar',
    join: 'unir',
    sk: 'saltar',
    mr_phrase: 'en anillo mágico',
    from_hook_phrase: 'en 2ª cad desde el gancho',
  },
};

function classifyCanonicalOp(rawOp: string, fromDialect: CrochetDialect): CanonicalOp | null {
  const t = rawOp.toLowerCase().replace(/\s+/g, ' ').trim();

  // Magic ring phrases
  if (
    /^(?:in\s+(?:a\s+)?(?:magic\s+ring|magic\s+circle|mr|mc)|en\s+(?:un\s+)?(?:anillo\s+m[aá]gico|am))$/i.test(
      t
    )
  ) {
    return 'mr_phrase';
  }

  // From hook phrases
  if (
    /^(?:in\s+(?:the\s+)?(?:2nd|second)\s+(?:ch|chain)\s+from\s+(?:the\s+)?hook|en\s+(?:la\s+)?(?:2[ª°]?|segunda)\s+(?:cad|cadena)\s+desde\s+el\s+gancho)$/i.test(
      t
    )
  ) {
    return 'from_hook_phrase';
  }

  if (t === 'ch' || t === 'chain' || t === 'chains' || t === 'cad' || t === 'cadena' || t === 'cadenas') {
    return 'ch';
  }
  if (
    t === 'sl st' ||
    t === 'slst' ||
    t === 'slip stitch' ||
    t === 'slip stitches' ||
    t === 'pd' ||
    t === 'pe' ||
    t === 'punto deslizado' ||
    t === 'punto enano'
  ) {
    return 'sl_st';
  }
  if (t === 'inc' || t === 'increase' || t === 'increases' || t === 'aum' || t === 'aumento' || t === 'aumentos') {
    return 'inc';
  }
  if (
    t === 'dec' ||
    t === 'decrease' ||
    t === 'decreases' ||
    t === 'invdec' ||
    t === 'dism' ||
    t === 'disminucion' ||
    t === 'disminución'
  ) {
    return 'dec';
  }
  if (t === 'blo' || t === 'pht') return 'blo';
  if (t === 'flo' || t === 'phd') return 'flo';
  if (t === 'turn' || t === 'girar') return 'turn';
  if (t === 'join' || t === 'unir') return 'join';
  if (t === 'sk' || t === 'skip' || t === 'saltar') return 'sk';

  // Unambiguous Spanish stitches
  if (t === 'pb' || t === 'mp' || t === 'punto bajo' || t === 'medio punto') return 'sc';
  if (t === 'pma' || t === 'mpa' || t === 'punto medio alto' || t === 'medio punto alto') {
    return 'hdc';
  }
  if (t === 'pa' || t === 'punto alto' || t === 'vareta') return 'dc';
  if (t === 'pad' || t === 'punto alto doble' || t === 'vareta doble') return 'tr';

  // Unambiguous UK stitches
  if (t === 'htr' || t === 'half treble') return 'hdc';
  if (t === 'dtr' || t === 'double treble') return 'tr';

  // Unambiguous US stitches
  if (t === 'sc' || t === 'single crochet' || t === 'single crochets') return 'sc';
  if (t === 'hdc' || t === 'half double crochet' || t === 'half double') return 'hdc';

  // Dialect-sensitive overlapping terms ('dc' and 'tr')
  if (t === 'dc' || t === 'double crochet' || t === 'double crochets') {
    return fromDialect === 'UK' ? 'sc' : 'dc';
  }
  if (t === 'tr' || t === 'trc' || t === 'treble' || t === 'triple crochet') {
    return fromDialect === 'UK' ? 'dc' : 'tr';
  }

  return null;
}

function transcribeInstructionBody(
  body: string,
  fromDialect: CrochetDialect,
  toDialect: CrochetDialect
): { text: string; count: number } {
  let count = 0;

  //Single-pass regex matching phrases, post-stitches (FPdc/BPdc), spaceless counts (4sc), and standalone tokens
  const tokenRegex =
    /(\bin\s+(?:a\s+)?(?:magic\s+ring|magic\s+circle|mr|mc)\b|\ben\s+(?:un\s+)?(?:anillo\s+m[aá]gico|am)\b|\bin\s+(?:the\s+)?(?:2nd|second)\s+(?:ch|chain)\s+from\s+(?:the\s+)?hook\b|\ben\s+(?:la\s+)?(?:2[ª°]?|segunda)\s+(?:cad|cadena)\s+desde\s+el\s+gancho\b|\b(?:fp|bp)(?:sc|hdc|dc|tr|htr|dtr|pb|pma|pa|pad)\b|(?:\b\d+\s*)?(?:\b(?:sl\s*st|slip\s+stitch(?:es)?|single\s+crochet(?:s)?|half\s+double\s+crochet(?:s)?|double\s+crochet(?:s)?|triple\s+crochet|double\s+treble|half\s+treble|punto\s+deslizado|punto\s+enano|punto\s+bajo|medio\s+punto|punto\s+medio\s+alto|punto\s+alto\s+doble|punto\s+alto|cadenas?|cadena|aumentos?|aumento|disminuci[oó]n|sc|hdc|dc|tr|trc|treble|htr|dtr|ch|chains?|inc|increases?|dec|decreases?|invdec|pb|mp|pma|mpa|pa|pad|pd|pe|cad|aum|dism|blo|flo|pht|phd|turn|girar|join|unir|sk|skip|saltar)\b))/gi;

  const text = body.replace(tokenRegex, (fullMatch) => {
    // 1. Check post stitches like FPdc / BPdc / FPpb
    const postMatch = fullMatch.match(/^(fp|bp)(sc|hdc|dc|tr|htr|dtr|pb|pma|pa|pad)$/i);
    if (postMatch) {
      const prefix = postMatch[1].toUpperCase();
      const innerCanonical = classifyCanonicalOp(postMatch[2], fromDialect);
      if (innerCanonical) {
        const mapped = `${prefix}${TARGET_STRINGS[toDialect][innerCanonical]}`;
        if (mapped.toLowerCase() !== fullMatch.toLowerCase()) {
          count++;
        }
        return mapped;
      }
      return fullMatch;
    }

    // 2. Check optional leading count prefix (e.g. "4sc" or "12 sc")
    const countPrefixMatch = fullMatch.match(/^(\d+)(\s*)(.+)$/);
    let numPart = '';
    let sepPart = '';
    let opPart = fullMatch;
    if (countPrefixMatch) {
      numPart = countPrefixMatch[1];
      sepPart = countPrefixMatch[2];
      opPart = countPrefixMatch[3];
    }

    const canonical = classifyCanonicalOp(opPart, fromDialect);
    if (!canonical) {
      return fullMatch;
    }

    let replacementOp = TARGET_STRINGS[toDialect][canonical];
    // Preserve leading capitalization on standalone words like "Chain 7" -> "Cad 7" or "Inc" -> "Aum"
    if (
      numPart === '' &&
      opPart.length > 1 &&
      opPart[0] === opPart[0].toUpperCase() &&
      opPart[1] === opPart[1].toLowerCase() &&
      canonical !== 'blo' &&
      canonical !== 'flo'
    ) {
      replacementOp = replacementOp[0].toUpperCase() + replacementOp.slice(1);
    }

    const result = numPart ? `${numPart}${sepPart}${replacementOp}` : replacementOp;
    if (result.toLowerCase() !== fullMatch.toLowerCase()) {
      count++;
    }
    return result;
  });

  return { text, count };
}

/**
 * Transcribes stitch instructions in a pattern from `fromDialect` to `toDialect`
 * while preserving comments, piece headers, and freeform prose notes untouched.
 */
export function transcribePatternDialect(
  patternText: string,
  fromDialect: CrochetDialect,
  toDialect: CrochetDialect
): { text: string; replacedCount: number } {
  if (fromDialect === toDialect || !patternText.trim()) {
    return { text: patternText, replacedCount: 0 };
  }

  let replacedCount = 0;
  const lines = patternText.split('\n');

  const updatedLines = lines.map((rawLine) => {
    let mainPart = rawLine;
    let trailingComment = '';

    const slashMatch = rawLine.match(/(\s+\/\/.*)$/);
    const hashMatch = rawLine.match(/(\s+#(?![0-9a-f]{3,6}\b).*)$/i);
    if (slashMatch && slashMatch.index !== undefined) {
      mainPart = rawLine.slice(0, slashMatch.index);
      trailingComment = slashMatch[1];
    } else if (hashMatch && hashMatch.index !== undefined) {
      mainPart = rawLine.slice(0, hashMatch.index);
      trailingComment = hashMatch[1];
    }

    const trimmed = mainPart.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('@')) {
      return rawLine;
    }

    // Standalone Fasten Off / Cerrar line
    if (/^(?:fasten\s+off|cerrar|rematar)\s*$/i.test(trimmed)) {
      const targetFo = toDialect === 'ES' ? 'Cerrar' : 'Fasten off';
      if (trimmed.toLowerCase() !== targetFo.toLowerCase()) {
        replacedCount++;
        const leadingWs = mainPart.match(/^\s*/)?.[0] ?? '';
        return `${leadingWs}${targetFo}${trailingComment}`;
      }
      return rawLine;
    }

    // Row / Round / Numbered instruction line
    const rowHeaderMatch = mainPart.match(
      /^(\s*(?:foundation\s*[:.-]|(?:rnds?|rounds?|rows?|r)\s*\d+(?:\s*[-–—to]+\s*(?:(?:rnds?|rounds?|rows?|r)\s*)?\d+)?(?:\s*\([^)]*\))?(?:\s*\[(?:RS|WS)\])?(?:\s*[:.-]|\s+)|\d+(?:\s*[-–—]\s*\d+)?\s*[.):-])\s*)(.+)$/i
    );
    if (rowHeaderMatch) {
      const header = rowHeaderMatch[1];
      const body = rowHeaderMatch[2];
      const { text: newBody, count } = transcribeInstructionBody(body, fromDialect, toDialect);
      replacedCount += count;
      return `${header}${newBody}${trailingComment}`;
    }

    // Bare unnumbered foundation chain or magic ring line
    if (
      /^(?:(?:ch|chain|chains|cad|cadenas)\s+\d+|\d+\s*(?:ch|chain|chains|cad|cadenas)|\d+\s*(?:sc|dc|pb)\s+in\s+(?:a\s+)?(?:magic\s+ring|mr|mc))\b/i.test(
        trimmed
      )
    ) {
      const { text: newBody, count } = transcribeInstructionBody(mainPart, fromDialect, toDialect);
      replacedCount += count;
      return `${newBody}${trailingComment}`;
    }

    // Border / inline CC instruction line (with a comma followed by stitches)
    if (/^(?:cc|border|edging)\s*:.*,/.test(trimmed)) {
      const commaIdx = mainPart.indexOf(',');
      const prefix = mainPart.slice(0, commaIdx + 1);
      const body = mainPart.slice(commaIdx + 1);
      const { text: newBody, count } = transcribeInstructionBody(body, fromDialect, toDialect);
      replacedCount += count;
      return `${prefix}${newBody}${trailingComment}`;
    }

    return rawLine;
  });

  return {
    text: updatedLines.join('\n'),
    replacedCount,
  };
}

/**
 * Auto-detects whether a newly loaded pattern is predominantly Spanish (`ES`), UK (`UK`), or US (`US`).
 */
export function detectPatternDialect(patternText: string): CrochetDialect | null {
  const instructionText = patternText
    .split('\n')
    .map((line) => line.replace(/\s+\/\/.*$/, '').replace(/\s+#(?![0-9a-f]{3,6}\b).*$/i, '').trim())
    .filter((line) =>
      /^(?:foundation\s*[:.-]|(?:rnds?|rounds?|rows?|r)\s*\d+|\d+(?:\s*[-–—]\s*\d+)?\s*[.):-]|(?:cc|border|edging)\s*:)/i.test(
        line
      )
    )
    .join('\n');

  const esHits = (
    instructionText.match(/\b(?:pb|pma|aum|dism|cad|cadenas|pht|phd|anillo\s+m[aá]gico)\b/gi) ?? []
  ).length;
  const ukHits = (
    instructionText.match(/\b(?:htr|dtr|half\s+treble|double\s+treble)\b/gi) ?? []
  ).length;
  const usHits = (
    instructionText.match(/\b(?:sc|hdc|single\s+crochet|half\s+double)\b/gi) ?? []
  ).length;

  if (esHits >= 2 && esHits > usHits) return 'ES';
  if (ukHits >= 1 && usHits === 0) return 'UK';
  if (usHits >= 2 && esHits === 0) return 'US';
  return null;
}
