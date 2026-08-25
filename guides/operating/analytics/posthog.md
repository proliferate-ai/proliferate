# Operate PostHog

Status: current procedure

Use this procedure to verify hosted-client analytics without changing project
configuration. Session replay is source-disabled on Web and Mobile and
internal-audience-only on Desktop, so the only replay that can appear belongs
to an internal account. The system contract is
[PostHog](../../../specs/codebase/systems/engineering/analytics/posthog.md).

## Applicability

- **Hosted Proliferate:** use these steps for Desktop, Web, and Mobile builds
  that are intentionally configured for the hosted PostHog project.
- **Self-hosters:** packaged Desktop does not initialize PostHog when pointed
  at a self-managed API. A fork that supplies its own Web/Mobile PostHog
  configuration owns its provider project and should still preserve the code
  privacy posture and the replay boundary.

## Secret Safety

Begin with read-only discovery. Never put PostHog keys or personal API tokens
in CLI arguments, shell history, command output, screenshots, issues, PRs,
documentation, or chat. Use deployment metadata that reveals only whether a
setting is present, not its value. Do not capture auth headers or complete
network requests in screenshots.

## Read-Only Verification

1. Identify the exact client build and surface. Record its canonical release
   id, environment, and whether the telemetry gate was enabled, without
   recording any secret value. The only replay gate is the Desktop internal
   audience plus the PostHog project's own replay setting; neither is a build
   or environment value.
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
5. Replay expectations by surface. Web and Mobile PostHog session recording
   are source-disabled and expose no toggle in any build, environment, or
   project setting, so replay observed there is a code-or-provider truth
   mismatch to triage. Desktop replay is expected only for a signed-in internal
   account and only while the PostHog project has replay enabled; a Desktop
   replay attributed to a customer account is a truth mismatch to triage
   immediately. In any Desktop replay, every recorded URL must read as a
   bounded route template such as `/workflows/:workflowId` or `/unknown`. A raw
   identifier in a recorded URL is a privacy regression: capture the release
   and route template, stop replay in the PostHog project, and route it as a
   defect.

## Diagnose Missing Evidence

- No events at all: confirm the build has a key, telemetry is not disabled,
  and Desktop resolved to `hosted_product`.
- Some Desktop events missing: compare the event name with the exact allowlist
  in `apps/desktop/src/lib/integrations/telemetry/client.ts`.
- Web/Mobile views missing: verify the provider initialized and the normalized
  route/screen hook ran; raw paths are intentionally not capture values.
- Replay missing on Web or Mobile: expected, not a defect; there is no gate to
  confirm. Replay missing on Desktop: check that the account is in the internal
  audience list and that the PostHog project has replay enabled.
- Provider data differs from checked-in behavior: capture event name, surface,
  environment, release, observed time, and a redacted provider URL, and raise
  the defect directly (there is no downstream issue-ingestion system).

Any project setting, retention, person/profile, or provider write requires a
separate reviewed change; widening Desktop replay beyond the internal audience,
or re-enabling Web or Mobile replay, additionally requires a synthetic privacy
qualification. This procedure does not authorize one.
