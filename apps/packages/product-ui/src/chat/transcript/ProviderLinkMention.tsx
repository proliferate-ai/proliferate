import { useState, type ReactNode } from "react";
import { GitHub } from "@proliferate/ui/icons";

/**
 * Inline "mention"-style rendering for external links in markdown bodies, with
 * a provider icon: a brand SVG for known hosts (GitHub) and the site's own
 * favicon for any other URL (AWS console, Linear, Vercel, …) — no per-provider
 * code and no third-party favicon service.
 *
 * Favicon resolution falls back gracefully: `https://<host>/favicon.ico`, then
 * the registrable root domain's favicon (so `console.aws.amazon.com` → the
 * `amazon.com` icon if the subdomain has none), then no icon at all. All
 * requests go to the linked site itself, so no host list leaks to a third party.
 *
 * Styling matches the desktop file-path mention (see FileReferenceBadge): a
 * muted blue at rest with no underline, brightening to the foreground color and
 * a dashed underline on hover, plus an inline provider icon sized to one
 * line-height. Non-URL hrefs (mailto:, #anchor, relative paths) fall back to a
 * plain underlined link.
 */

const INLINE_MENTION_CLASS =
  "group/inline-mention inline whitespace-normal break-words align-baseline font-medium leading-[inherit] text-[color:color-mix(in_srgb,var(--color-link-foreground)_80%,var(--color-foreground)_20%)] no-underline transition-colors hover:text-foreground hover:underline hover:decoration-current hover:decoration-dashed hover:decoration-[0.5px] hover:underline-offset-2 focus-visible:outline-none focus-visible:underline";

const PLAIN_LINK_CLASS =
  "text-link-foreground underline decoration-current decoration-[0.5px] decoration-opacity-50 transition-colors hover:decoration-opacity-100";

const ICON_SHELL_CLASS =
  "relative mr-[3px] inline-block h-[1lh] w-3.5 shrink-0 align-bottom";
const ICON_CLASS = "absolute left-0 top-1/2 size-3.5 -translate-y-1/2";

export function ProviderLinkMention({
  href,
  children,
}: {
  href: string;
  children?: ReactNode;
}): ReactNode {
  const host = linkHost(href);
  if (!host) {
    // mailto:, #fragment, relative, or unparseable — keep a plain link.
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={PLAIN_LINK_CLASS}>
        {children}
      </a>
    );
  }
  const normalizedHref = href.includes("://") ? href : `https://${href}`;
  return (
    <a
      href={normalizedHref}
      target="_blank"
      rel="noopener noreferrer"
      data-provider-link-host={host}
      className={INLINE_MENTION_CLASS}
    >
      <LinkIcon host={host} />
      <span className="min-w-0 break-words">{children}</span>
    </a>
  );
}

function LinkIcon({ host }: { host: string }): ReactNode {
  if (host === "github.com" || host.endsWith(".github.com")) {
    return (
      <span aria-hidden="true" className={ICON_SHELL_CLASS}>
        <GitHub className={ICON_CLASS} />
      </span>
    );
  }
  return <FaviconIcon host={host} />;
}

/**
 * Try the host's own `/favicon.ico`, then the root domain's, then render no icon
 * — advancing through the candidates on each load error.
 */
function FaviconIcon({ host }: { host: string }): ReactNode {
  const [stage, setStage] = useState(0);
  const candidates = faviconCandidates(host);
  if (stage >= candidates.length) {
    return null;
  }
  return (
    <span aria-hidden="true" className={ICON_SHELL_CLASS}>
      <img
        key={candidates[stage]}
        src={candidates[stage]}
        alt=""
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setStage((current) => current + 1)}
        className={`${ICON_CLASS} rounded-[2px] object-contain`}
      />
    </span>
  );
}

function faviconCandidates(host: string): string[] {
  const root = rootDomain(host);
  return root === host
    ? [`https://${host}/favicon.ico`]
    : [`https://${host}/favicon.ico`, `https://${root}/favicon.ico`];
}

/** Registrable domain heuristic (last two labels) — good enough for favicons. */
export function rootDomain(host: string): string {
  const labels = host.split(".").filter(Boolean);
  return labels.length > 2 ? labels.slice(-2).join(".") : host;
}

/**
 * Hostname for an external http(s) link, or null when the href is not an
 * external URL (relative path, mailto:, #fragment, custom scheme). Accepts
 * scheme-less hosts like `github.com/org/repo` and `www.example.com`.
 */
export function linkHost(href: string): string | null {
  if (!isExternalHttpLink(href)) {
    return null;
  }
  try {
    const url = new URL(href.includes("://") ? href : `https://${href}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether an href should be treated as an external web link (vs. a workspace
 * file path). Conservative: `http(s)://…`, `www.…`, and a bare `host.tld/path`
 * form only when the TLD is a well-known web TLD (see {@link isSchemelessWebHost}).
 *
 * The TLD allow-list is what keeps a relative file path with a dotted directory
 * (`v1.2/notes.txt`, `CHANGELOG.md/x`) from being mistaken for a host: their
 * "TLD" (`2`, `md`) is not a web TLD, so they stay file mentions. Without this,
 * `github.com/org/repo` rendered as a dead FilePathLink (it never resolves to a
 * workspace file), so we now claim it as an external link.
 */
export function isExternalHttpLink(href: string): boolean {
  const value = href.trim();
  return (
    /^https?:\/\//i.test(value) ||
    /^www\.[a-z0-9-]/i.test(value) ||
    isSchemelessWebHost(value)
  );
}

/**
 * Web TLDs common enough that they unambiguously signal a host rather than a
 * file extension. Deliberately small: every entry must be a TLD that is never a
 * real file extension (so it can't steal `notes.md`, `data.io` would be rare).
 */
const WEB_TLDS = new Set([
  "com",
  "org",
  "net",
  "io",
  "dev",
  "app",
  "ai",
  "co",
  "gov",
  "edu",
]);

/**
 * A bare `host.tld/path` link with a well-known web TLD and at least one path
 * segment (so a bare `foo.com` filename-with-extension is not claimed). The
 * host's final label must be a {@link WEB_TLDS} entry; this is what lets
 * `github.com/org/repo` through while leaving `v1.2/notes.txt` to file
 * detection.
 */
export function isSchemelessWebHost(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.includes("://")) {
    return false;
  }
  const slash = trimmed.indexOf("/");
  // Require a path segment after the host so a bare token isn't claimed.
  if (slash <= 0 || slash === trimmed.length - 1) {
    return false;
  }
  const host = trimmed.slice(0, slash).toLowerCase();
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => label.length === 0)) {
    return false;
  }
  return WEB_TLDS.has(labels[labels.length - 1]);
}
