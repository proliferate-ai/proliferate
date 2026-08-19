# Operate PostHog

Status: current procedure

Use this procedure to verify hosted-client analytics and replay routing without
changing project configuration. The system contract is
[PostHog](../../../specs/codebase/systems/engineering/analytics/posthog.md).

## Applicability

- **Hosted Proliferate:** use these steps for Desktop, Web, and Mobile builds
  that are intentionally configured for the hosted PostHog project.
- **Self-hosters:** packaged Desktop does not initialize PostHog when pointed
  at a self-managed API. A fork that supplies its own Web/Mobile PostHog
  configuration owns its provider project and should still preserve the code
  privacy and replay defaults.

## Secret Safety

Begin with read-only discovery. Never put PostHog keys or personal API tokens
in CLI arguments, shell history, command output, screenshots, issues, PRs,
documentation, or chat. Use deployment metadata that reveals only whether a
setting is present, not its value. Do not capture auth headers or complete
network requests in screenshots.

## Read-Only Verification

1. Identify the exact client build and surface. Record its canonical release
   id, environment, and whether telemetry/replay gates were enabled without
   recording their secret values.
2. For a named Desktop local profile, inspect only the non-secret runtime
   routing fields in:

   ```text
   ~/.proliferate-local/dev/profiles/<name>/app/config.json
   ```

   `telemetryDisabled` and `apiBaseUrl` are read once at startup; relaunch is
   required after an authorized change.
3. Exercise one already-allowlisted action in a non-production test account.
   In browser/Desktop developer tools, confirm the event name and sanitized
   low-cardinality properties. Do not copy request authorization or payloads
   containing identity into an issue or chat.
4. In the authenticated PostHog UI, filter read-only by the exact release,
   environment, and test account distinct id. Verify:
   - the expected allowlisted Desktop event or Web/Mobile view event arrived;
   - identity is the authenticated user UUID only, with no email or display-name person properties;
   - sign-out produces a new anonymous identity on the next session;
   - no prompt, transcript, repo name, file path, raw URL, terminal text,
     token, or raw error is present.
5. Desktop replay is expected to be absent. Desktop PostHog session recording
   is source-disabled, so any Desktop replay observed in the provider is a
   code-or-provider truth mismatch to triage, not a gate to look for or enable.
   Synthetic replay verification applies only to a surface whose reviewed
   source currently permits replay. For such a surface, verify input masking
   and block/mask selectors with synthetic data only, and inspect whether
   recorded page metadata contains workflow, workspace, or chat route ids;
   that is a known current gap even though event URL properties are scrubbed.

## Diagnose Missing Evidence

- No events at all: confirm the build has a key, telemetry is not disabled,
  and Desktop resolved to `hosted_product`.
- Some Desktop events missing: compare the event name with the exact allowlist
  in `apps/desktop/src/lib/integrations/telemetry/client.ts`.
- Web/Mobile views missing: verify the provider initialized and the normalized
  route/screen hook ran; raw paths are intentionally not capture values.
- Replay missing on a surface whose source permits it: confirm that surface's
  separate replay gate. Mobile also needs the optional native replay package in
  that build. Missing Desktop replay is the expected result, not a defect.
- Provider data differs from checked-in behavior: capture event name, surface,
  environment, release, observed time, and a redacted provider URL. Route
  ingestion or deduplication defects to Issue Lifecycle.

Any project setting, replay gate, retention, person/profile, or provider write
requires a separate reviewed change. This procedure does not authorize one.
