interface TextMap {
  normalized: string;
  /** One (node, offset) per character of `normalized`. */
  positions: Array<{ node: Text; offset: number }>;
}

/**
 * Re-locates each annotation excerpt inside the rendered transcript and
 * returns a live Range per annotation (null when the text is not currently in
 * the DOM — virtualized away or re-rendered differently). Matching is
 * whitespace-normalized because `Selection.toString()` and element
 * `textContent` disagree about the whitespace between formatting boundaries.
 * Identical excerpts claim distinct occurrences in annotation order.
 */
export function findAnnotationRanges(
  root: HTMLElement,
  texts: readonly string[],
): Array<Range | null> {
  const maps = Array.from(root.querySelectorAll("[data-assistant-prose]"))
    .map(buildTextMap);
  const used: Array<{ map: TextMap; start: number; end: number }> = [];

  return texts.map((text) => {
    const target = normalizeWhitespace(text);
    if (!target) {
      return null;
    }
    for (const map of maps) {
      let from = 0;
      while (from <= map.normalized.length - target.length) {
        const at = map.normalized.indexOf(target, from);
        if (at === -1) {
          break;
        }
        const end = at + target.length;
        const overlaps = used.some((claim) =>
          claim.map === map && at < claim.end && end > claim.start,
        );
        if (!overlaps) {
          used.push({ map, start: at, end });
          const range = document.createRange();
          const startPosition = map.positions[at]!;
          const endPosition = map.positions[end - 1]!;
          range.setStart(startPosition.node, startPosition.offset);
          range.setEnd(endPosition.node, endPosition.offset + 1);
          return range;
        }
        from = at + 1;
      }
    }
    return null;
  });
}

function buildTextMap(block: Element): TextMap {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let normalized = "";
  const positions: TextMap["positions"] = [];
  let pendingSpace = false;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const content = textNode.data;
    for (let offset = 0; offset < content.length; offset += 1) {
      if (/\s/u.test(content[offset]!)) {
        pendingSpace = normalized.length > 0;
        continue;
      }
      if (pendingSpace) {
        normalized += " ";
        // The separator has no single source character; anchor it to the
        // character that follows so ranges stay within real text nodes.
        positions.push({ node: textNode, offset });
        pendingSpace = false;
      }
      normalized += content[offset]!;
      positions.push({ node: textNode, offset });
    }
  }
  return { normalized, positions };
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}
