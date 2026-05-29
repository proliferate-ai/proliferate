export interface SlashCommandTrigger {
  start: number;
  end: number;
  query: string;
}

export function findSlashCommandTrigger(
  text: string,
  selectionOffset: number,
): SlashCommandTrigger | null {
  if (selectionOffset < 0 || selectionOffset > text.length) {
    return null;
  }

  const tokenStart = findTokenStart(text, selectionOffset);
  if (text[tokenStart] !== "/") {
    return null;
  }

  // Native slash commands are only sent at prompt start; inline slash text is
  // ordinary prompt content.
  const prefix = text.slice(0, tokenStart);
  if (!/^\s*$/u.test(prefix)) {
    return null;
  }

  const tokenEnd = findTokenEnd(text, selectionOffset);
  return {
    start: tokenStart,
    end: tokenEnd,
    query: text.slice(tokenStart + 1, selectionOffset),
  };
}

function findTokenStart(text: string, selectionOffset: number): number {
  let offset = selectionOffset;
  while (offset > 0 && !/\s/u.test(text[offset - 1] ?? "")) {
    offset -= 1;
  }
  return offset;
}

function findTokenEnd(text: string, selectionOffset: number): number {
  let offset = selectionOffset;
  while (offset < text.length && !/\s/u.test(text[offset] ?? "")) {
    offset += 1;
  }
  return offset;
}
