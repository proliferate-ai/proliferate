# Frontend Telemetry Standards

Status: authoritative for frontend telemetry in `desktop/src/**`.

Use this doc for analytics events, exception capture, anonymous telemetry,
session replay, and telemetry-related provider and hook ownership.

## Ownership

- `providers/**` owns app-wide telemetry boundaries such as bootstrap wiring.
- `hooks/**` owns UI-facing telemetry side effects.
- `components/**` render and should not import telemetry helpers directly,
  except explicit error boundaries.
- `lib/integrations/telemetry/**` owns transport mechanics for both vendor and
  anonymous telemetry, not product workflow decisions.
- `lib/domain/telemetry/**` owns typed event catalogs, safe enums, and pure
  telemetry helpers.
- Keep one telemetry tree and one `TelemetryProvider`. Anonymous telemetry is a
  second backend inside the existing telemetry system, not a parallel provider
  or folder tree.

## Runtime Modes

- Desktop runtime telemetry routing uses one mode field:
  - `local_dev`
  - `self_managed`
  - `hosted_product`
- `trackProductEvent(...)` remains the frontend fanout seam. Hooks continue to
  emit typed product events, and the telemetry client decides whether they go to
  vendor telemetry, anonymous telemetry, or both.
- Vendor telemetry is enabled only in `hosted_product`.
- Anonymous telemetry may be enabled in all runtime modes unless explicitly
  disabled.

## Anonymous Records

- Anonymous telemetry records must stay install-level and structured.
- Current anonymous record types are:
  - `VERSION`
  - `ACTIVATION`
  - `USAGE`
- Anonymous payloads must not include user identity, transcript content,
  terminal output, repo names, raw paths, raw error strings, or other
  free-form/high-cardinality strings.

## Events

- Product events must be defined in the typed event catalog under
  `lib/domain/telemetry/events.ts`.
- Event names should stay stable when possible. Prefer changing payload shape
  and ownership over renaming events.
- Hosted-product PostHog should stay intentionally allowlisted. If an event is
  not in the vendor allowlist, it may still produce Sentry breadcrumbs without
  becoming a PostHog event.
- Event payloads must be low-risk and structured: enums, booleans, counts,
  versions, provider kinds, workspace kind, and similar fields.
- Do not send prompts, transcript content, terminal output, file contents,
  repo names, absolute paths, raw URLs with secrets, or raw error messages in
  analytics payloads.
- Do not use arbitrary string bags for analytics. Add the field to the typed
  event map first.

## Exception Capture

- Vendor exception capture (Sentry) is hosted-product only in v1.
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
- Prefer deriving anonymous telemetry from existing typed product events rather
  than adding a second telemetry call at each workflow hook.
- Capture exceptions from hooks or boundaries, not from ordinary render
  components.
- If a platform wrapper currently swallows errors, move the fallback behavior
  up into a hook when the UI needs telemetry around that failure.
