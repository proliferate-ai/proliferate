import { useState, type ReactNode } from "react";
import { GitHub, Globe } from "@proliferate/ui/icons";

/**
 * Inline "mention"-style rendering for external links in markdown bodies, with
 * a provider icon: a brand SVG for known hosts (GitHub) and the site's favicon
 * for any other URL (AWS console, Linear, Vercel, …) — no per-provider code.
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
      <span aria-hidden="true" className={ICON_SHELL_CLASS}>
        <LinkIcon host={host} className={ICON_CLASS} />
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </a>
  );
}

function LinkIcon({ host, className }: { host: string; className: string }): ReactNode {
  const [faviconFailed, setFaviconFailed] = useState(false);
  if (host === "github.com" || host.endsWith(".github.com")) {
    return <GitHub className={className} aria-hidden="true" />;
  }
  if (faviconFailed) {
    return <Globe className={className} aria-hidden="true" />;
  }
  return (
    <img
      src={faviconUrl(host)}
      alt=""
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFaviconFailed(true)}
      className={`${className} rounded-[2px] object-contain`}
    />
  );
}

/** Google's favicon service: more reliable than `{origin}/favicon.ico`. */
function faviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
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
 * file path). True for `http(s)://…`, `www.…`, and bare `host.tld[/…]` forms.
 */
export function isExternalHttpLink(href: string): boolean {
  const value = href.trim();
  if (/^https?:\/\//i.test(value)) {
    return true;
  }
  if (value.includes("://") || value.startsWith("//")) {
    // any other scheme:// (ftp:, vscode:, …) or protocol-relative — not a
    // workspace file path, but only http(s) gets an icon.
    return false;
  }
  // Scheme-less `www.host…` is a strong web signal.
  if (/^www\.[a-z0-9-]/i.test(value)) {
    return true;
  }
  // Other scheme-less `host.tld/path` forms — require a trailing path slash so
  // bare filenames like `README.md` (host.tld shaped) stay file references.
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s]/i.test(value);
}
