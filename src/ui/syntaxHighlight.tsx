import { ReactNode } from 'react';

function renderHighlightedClause(text: string, keyPrefix: string): ReactNode[] {
  const tokenRegex =
    /(\[(?:RS|WS|[a-zA-Z0-9\s#_-]+)\]|\b(?:BLO|FLO|FP|BP|CC|MR|MC|RS|WS)\b:?|\b(?:ch|chain|chains|sl\s*st|slip\s+stitch(?:es)?|sc|single\s+crochet(?:s)?|hdc|half\s+double\s+crochet(?:s)?|dc|double\s+crochet(?:s)?|tr|trc|treble|dtr|htr|inc|increase(?:s)?|dec|decrease(?:s)?|invdec|sc2tog|sc3tog|dc2tog|dc3tog|hdc2tog|fpdc|bpdc|fphdc|bphdc|fpsc|bpsc|fptr|bptr|bobble|puff|popcorn|cluster|picot|v-st|pb|pa|pma|pad|pd|pe|cad|cadenas?|aum|dism|pht|phd|am|magic\s+ring|magic\s+circle|turn|join|sk|skip)\b|\b\d+\s*(?:sc|hdc|dc|tr|ch|sl\s*st|inc|dec|pb|pa|pma|cad|aum|dism)\b|(?:x|\*)\s*\d+|\b\d+\s*times\b)/gi;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const lower = token.toLowerCase();
    let cls = 'syn-stitch';
    if (
      lower.startsWith('[') ||
      /^(?:blo|flo|fp|bp|cc|rs|ws)/i.test(lower)
    ) {
      cls = 'syn-modifier';
    } else if (/^(?:x|\*)\s*\d+|\d+\s*times$/i.test(lower)) {
      cls = 'syn-repeat';
    } else if (/^(?:turn|join|sk|skip)$/i.test(lower)) {
      cls = 'syn-keyword';
    }
    nodes.push(
      <span key={`${keyPrefix}-t-${tokIdx++}`} className={cls}>
        {token}
      </span>
    );
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export function highlightPatternLine(
  rawLine: string,
  lineIndex: number,
  diagnosticSeverity?: 'error' | 'warning' | 'info'
): ReactNode {
  if (rawLine.length === 0) {
    return '\n';
  }

  // Separate trailing inline comment (" // ..." or " # ..." not hex)
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

  // 1. Explicit full-line comment (# or //)
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return <span className="syn-comment">{rawLine}</span>;
  }

  // 2. @directive or plain-English Assembly sentence
  if (
    trimmed.startsWith('@') ||
    /^(?:(?:attach|glue|sew|pin)\s+.+\s+(?:to|on|under)\s+|(?:roll|coil)\s+.+\s+into\s+)/i.test(
      trimmed
    )
  ) {
    return (
      <>
        <span className="syn-directive">{mainPart}</span>
        {trailingComment && <span className="syn-comment">{trailingComment}</span>}
      </>
    );
  }

  // 3. Piece Section Header ("=== Shield ===" or "Legs (make 2):" or "Head [tan]:")
  const bannerMatch = trimmed.match(/^={2,}\s*(?:piece\s*:\s*)?(.+?)\s*={2,}$/i);
  const colonHeaderMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9\s()'_-]{1,40})(?:\[([^\]]+)\])?\s*:\s*$/
  );
  if (bannerMatch || colonHeaderMatch) {
    const rawTitle = (bannerMatch ? bannerMatch[1] : colonHeaderMatch![1]).trim();
    if (!/^(?:row|rnd|round|r\d+|cc|colou?r|note|tip|border|edging)$/i.test(rawTitle)) {
      return (
        <>
          <span className="syn-piece-header">{mainPart}</span>
          {trailingComment && <span className="syn-comment">{trailingComment}</span>}
        </>
      );
    }
  }

  // 4. Standalone Colour / CC / Border line
  if (
    /^(?:colou?r\s*:|change\s+colou?r\s+to\b|cc\s*:|border\s*:|edging\s*:)/i.test(trimmed)
  ) {
    const prefixMatch = mainPart.match(
      /^(\s*(?:colou?r\s*:|change\s+colou?r\s+to\b|cc\s*:(?:\s*to\b)?|border\s*:|edging\s*:))/i
    );
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      const rest = mainPart.slice(prefix.length);
      return (
        <>
          <span className="syn-modifier">{prefix}</span>
          {renderHighlightedClause(rest, `L${lineIndex}`)}
          {trailingComment && <span className="syn-comment">{trailingComment}</span>}
        </>
      );
    }
  }

  // 5. Row / Round / Numbered Instruction Line
  const rowHeaderMatch = mainPart.match(
    /^(\s*(?:foundation\s*[:.-]|(?:rnds?|rounds?|rows?|r)\s*\d+(?:\s*[-–—to]+\s*\d+)?(?:\s*\([^)]*\))?(?:\s*\[(?:RS|WS)\])?\s*[:.-]|\d+(?:\s*[-–—]\s*\d+)?\s*[.):-])\s*)(.+)$/i
  );
  if (rowHeaderMatch) {
    const headerPart = rowHeaderMatch[1];
    let bodyPart = rowHeaderMatch[2];
    let countSuffix = '';

    const countMatch = bodyPart.match(
      /(\s*(?:\(\s*\d+\s*(?:sts?|stitches|pts?|puntos?)?\s*\)|\[\s*\d+\s*(?:sts?|stitches|pts?|puntos?)?\s*\]|—\s*\d+\s*(?:sts?|stitches)|\b\d+\s+(?:sts|stitches))\s*\.?\s*)$/i
    );
    if (countMatch && countMatch.index !== undefined) {
      countSuffix = countMatch[1];
      bodyPart = bodyPart.slice(0, countMatch.index);
    }

    return (
      <>
        <span className="syn-row-num">{headerPart}</span>
        {diagnosticSeverity && !countSuffix ? (
          <span className={`syn-squiggle syn-squiggle-${diagnosticSeverity}`}>
            {renderHighlightedClause(bodyPart, `L${lineIndex}`)}
          </span>
        ) : (
          renderHighlightedClause(bodyPart, `L${lineIndex}`)
        )}
        {countSuffix && (
          <span
            className={`syn-count ${
              diagnosticSeverity ? `syn-squiggle syn-squiggle-${diagnosticSeverity}` : ''
            }`}
          >
            {countSuffix}
          </span>
        )}
        {trailingComment && <span className="syn-comment">{trailingComment}</span>}
      </>
    );
  }

  // 6. Any unrecognized line beginning is parsed as a freeform comment / craft note!
  return (
    <span
      className={`syn-comment ${
        diagnosticSeverity ? `syn-squiggle syn-squiggle-${diagnosticSeverity}` : ''
      }`}
    >
      {rawLine}
    </span>
  );
}
