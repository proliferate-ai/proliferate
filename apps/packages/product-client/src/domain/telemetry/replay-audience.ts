/**
 * Who session replay is allowed to record.
 *
 * Replay re-enablement is staged. The route-identifier leak that caused the
 * 2026-08-18 source disable (#2083, #2093, #2096, #2097) is fixed and proven
 * at the payload level by `./route-id-redaction`, but the live synthetic
 * qualification that #2093 and #2096 named as the re-enable bar (real rrweb
 * output from the real app, plus controlled provider arrival) has not been
 * executed. Until it has, recording starts only for the internal audience.
 *
 * This is a source-owned closed list, not a configuration surface: there is no
 * environment variable, build value, or provider setting that widens it.
 * Widening it to customers is a reviewed source change to this file.
 *
 * The address is evaluated locally and never transmitted. PostHog identity
 * stays UUID-only (`identify(user.id)`), and `./scrub` redacts any `email`
 * key that reaches a payload.
 */

/**
 * Email domains treated as internal for replay purposes. Exact host match
 * only, so a look-alike domain (`notproliferate.com`,
 * `proliferate.com.example.net`) and a subdomain (`sub.proliferate.com`) are
 * both outside the audience.
 */
export const INTERNAL_REPLAY_EMAIL_DOMAINS: readonly string[] = [
  "proliferate.com",
  "proliferate.dev",
];

/**
 * True when this signed-in address belongs to the internal replay audience.
 * Anything ambiguous is false: replay stays off unless the address clearly
 * matches.
 */
export function isInternalReplayAudience(email: string | null | undefined): boolean {
  if (typeof email !== "string") return false;

  const normalized = email.trim().toLowerCase();
  const separatorIndex = normalized.lastIndexOf("@");
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) return false;

  const localPart = normalized.slice(0, separatorIndex);
  const domain = normalized.slice(separatorIndex + 1);
  // A whitespace-bearing address is malformed; treat it as untrusted input.
  if (/\s/.test(normalized) || localPart.length === 0) return false;

  return INTERNAL_REPLAY_EMAIL_DOMAINS.includes(domain);
}
