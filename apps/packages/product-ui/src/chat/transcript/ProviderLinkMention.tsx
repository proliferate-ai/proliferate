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
 * Styling matches the desktop file-mention look (see FileReferenceBadge): a
 * muted link color, an inline icon sized to one line-height, and a dashed
 * underline on hover. Non-URL hrefs (mailto:, #anchor, relative paths) fall
 * back to a plain underlined link.
 */

const INLINE_MENTION_CLASS =
  "group/inline-mention inline whitespace-normal break-words align-baseline font-medium leading-[inherit] text-[color:color-mix(in_srgb,var(--color-link-foreground)_80%,var(--color-foreground)_20%)] no-underline hover:underline hover:decoration-current hover:decoration-dashed hover:decoration-[0.5px] hover:underline-offset-2 focus-visible:outline-none focus-visible:underline";

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
 * file path). Deliberately conservative: only `http(s)://…` and `www.…`.
 *
 * A bare `host.tld/path` form (`github.com/x`) is NOT claimed, because it is
 * structurally indistinguishable from a relative file path with a dotted
 * directory (`v1.2/notes.txt`, `CHANGELOG.md/x`) — claiming those would lose
 * the file mention and fire a favicon fetch for a bogus host. Scheme-less URLs
 * are rare in agent output (they almost always emit `https://`), so this trades
 * that edge for never stealing a real file path.
 */
export function isExternalHttpLink(href: string): boolean {
  const value = href.trim();
  return /^https?:\/\//i.test(value) || /^www\.[a-z0-9-]/i.test(value);
}
