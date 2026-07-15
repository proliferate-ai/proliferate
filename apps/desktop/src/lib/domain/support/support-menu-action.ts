import type { SupportCapability } from "@/lib/domain/capabilities/server-capability-contract";

/**
 * What the sidebar/command-palette support action should do, derived from the
 * server-declared `support` capability.
 *
 * - `vendor` (hosted product): the existing feedback/prompt report flow.
 * - `operator` (self-managed, operator configured a destination): route to
 *   that destination directly — no vendor support-report window.
 * - `none` (self-managed, no destination configured): no support action at
 *   all. The desktop must not offer a vendor support address to a
 *   self-managed user, and there is nothing configured to route to instead.
 *
 * Pure domain: no React, no platform APIs.
 */
export type SupportMenuAction =
  | { kind: "vendor" }
  | { kind: "operator"; url: string }
  | { kind: "none" };

/**
 * Resolve the operator's configured destination into a single openable URL:
 * prefer `support.url`, else a `mailto:` built from `support.email`.
 */
function resolveOperatorUrl(support: SupportCapability): string | null {
  if (support.url) return support.url;
  if (support.email) return `mailto:${support.email}`;
  return null;
}

export function deriveSupportMenuAction(support: SupportCapability): SupportMenuAction {
  if (support.kind === "vendor") {
    return { kind: "vendor" };
  }
  if (support.kind === "operator") {
    const url = resolveOperatorUrl(support);
    // The server only declares `operator` when it configured an email or a
    // url, but degrade to `none` rather than crash if that ever drifts.
    return url ? { kind: "operator", url } : { kind: "none" };
  }
  return { kind: "none" };
}
