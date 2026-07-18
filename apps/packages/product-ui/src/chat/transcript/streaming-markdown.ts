const TRAILING_INCOMPLETE_INLINE_LINK = /\[([^\]\n]+)\]\(([^)\n]*)$/;

/**
 * Keep a trailing local-file link parseable while its destination is still
 * streaming. The synthetic closing delimiter exists only in the render copy;
 * the authoritative transcript content remains untouched.
 *
 * Without this, react-markdown exposes the entire unfinished source token —
 * including an absolute destination — until the real `)` arrives. Closing the
 * render copy lets the injected file-link renderer paint the final mention
 * immediately, so later destination chunks update behavior without replacing
 * a long raw path on screen.
 */
export function stabilizeStreamingMarkdown(content: string): string {
  const match = TRAILING_INCOMPLETE_INLINE_LINK.exec(content);
  if (!match || (match.index > 0 && content[match.index - 1] === "!")) {
    return content;
  }

  const destination = match[2]?.trim() ?? "";
  const unwrappedDestination = destination.startsWith("<")
    ? destination.slice(1)
    : destination;
  if (!looksLikeLocalFileDestination(unwrappedDestination)) {
    return content;
  }

  if (destination.startsWith("<") && !destination.endsWith(">")) {
    return `${content}>)`;
  }
  return `${content})`;
}

function looksLikeLocalFileDestination(destination: string): boolean {
  return (destination.startsWith("/") && !destination.startsWith("//"))
    || destination.startsWith("~/")
    || destination.startsWith("./")
    || destination.startsWith("../")
    || destination.startsWith("file:")
    || /^[a-zA-Z]:[\\/]/.test(destination);
}
