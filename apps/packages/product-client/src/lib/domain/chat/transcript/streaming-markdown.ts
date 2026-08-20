import { stabilizeStreamingFileLink } from "./file-link-markdown";

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
 *
 * The decision of what counts as a stabilizable tail belongs to the shared
 * transcript scanner, so streaming and settled repair cannot disagree about
 * code spans, fences, images, escapes, titles, or nested parentheses. Only an
 * explicit local-path prefix qualifies: every URI scheme, `file:` included, is
 * excluded because a scheme is an authority grant rather than a path.
 */
export function stabilizeStreamingMarkdown(content: string): string {
  return stabilizeStreamingFileLink(content);
}
