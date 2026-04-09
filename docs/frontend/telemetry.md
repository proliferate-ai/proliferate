# Frontend Telemetry Standards

Status: authoritative for frontend telemetry in `desktop/src/**`.

Use this doc for analytics events, exception capture, session replay, and
telemetry-related provider and hook ownership.

## Ownership

- `providers/**` owns app-wide telemetry boundaries such as bootstrap wiring.
- `hooks/**` owns UI-facing telemetry side effects.
- `components/**` render and should not import telemetry helpers directly,
  except explicit error boundaries.
- `lib/integrations/telemetry/**` owns vendor setup and transport mechanics,
  not product workflow decisions.
- `lib/domain/telemetry/**` owns typed event catalogs, safe enums, and pure
  telemetry helpers.

## Events

- Product events must be defined in the typed event catalog under
  `lib/domain/telemetry/events.ts`.
- Event names should stay stable when possible. Prefer changing payload shape
  and ownership over renaming events.
- Event payloads must be low-risk and structured: enums, booleans, counts,
  versions, provider kinds, workspace kind, and similar fields.
- Do not send prompts, transcript content, terminal output, file contents,
  repo names, absolute paths, raw URLs with secrets, or raw error messages in
  analytics payloads.
- Do not use arbitrary string bags for analytics. Add the field to the typed
  event map first.

## Exception Capture

- Prefer one capture path per failure.
- If a query or mutation hook captures its own exception, mark it with
  `meta.telemetryHandled = true` so the global React Query handlers do not
  report it again.
- Sentry tags must stay low-cardinality. Prefer stable keys such as `domain`,
  `action`, `provider`, `workspace_kind`, and `route`.
- Put high-cardinality or diagnostic values in scrubbed extras, not tags.
- Background callback and deep-link error handling may capture inside the
  orchestration layer when there is no clean hook boundary, but that should be
  the exception, not the rule.

## Replay and Privacy

- Session replay is opt-in and should default to disabled.
- When replay is enabled, workspace and settings surfaces should be blocked by
  default.
- Continue using explicit masking for input areas that may contain sensitive
  text.
- If a new surface can display prompts, files, paths, repo metadata, tokens,
  or credentials, block it unless there is a reviewed reason not to.

## Practical Rules

- Track analytics from hooks such as action hooks, mutation hooks, and
  telemetry bootstrap hooks.
- Capture exceptions from hooks or boundaries, not from ordinary render
  components.
- If a platform wrapper currently swallows errors, move the fallback behavior
  up into a hook when the UI needs telemetry around that failure.
