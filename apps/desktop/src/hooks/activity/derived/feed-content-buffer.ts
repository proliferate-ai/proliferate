/**
 * Trailing-window cap for the lightweight feed-tail preview. A long-lived,
 * verbose background process (dev server, watch task) left with a row expanded
 * would otherwise grow the accumulated `content` string without bound, with
 * every chunk triggering a full concat + re-render of an ever-growing `<pre>`.
 * The real terminal viewport has scrollback/backpressure; this preview keeps
 * only the last `MAX_FEED_CONTENT_CHARS` characters.
 */
export const MAX_FEED_CONTENT_CHARS = 256 * 1024;

/** Append `chunk` to `previous`, retaining only the trailing window. */
export function appendCappedFeedContent(previous: string, chunk: string): string {
  const next = previous + chunk;
  if (next.length <= MAX_FEED_CONTENT_CHARS) {
    return next;
  }
  return next.slice(next.length - MAX_FEED_CONTENT_CHARS);
}
