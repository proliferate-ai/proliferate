# Frontend Telemetry Standards

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
- Web and Mobile telemetry stays coarse unless a typed product event is added:
  route/screen events, hosted authenticated identity sync, and reviewed product
  events only.
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
- Hosted-product PostHog events should stay explicitly permitted. If an event
  is not permitted for the vendor backend, it may still produce Sentry
  breadcrumbs without becoming a PostHog event.
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
- For a handled AnyHarness failure, suppress ProductClient capture only when
  the cause chain contains an exact
  `urn:proliferate:anyharness:incident:<uuid>` RFC 7807 instance. Old runtimes,
  malformed or foreign instances, transport failures, and unrelated errors
  retain the sanitized client capture path.
- If a query or mutation hook captures its own exception, mark it with
  `meta.telemetryHandled = true` so the global React Query handlers do not
  report it again.
- The global query handler leaves cancellation, unambiguous auth/permission
  gates, explicitly coded GitHub App or AnyHarness hosting-availability states,
  and the Cowork `COWORK_THREAD_NOT_FOUND` lifecycle state in React Query
  without sending them as exceptions. Generic 4xx responses remain reportable,
  as do request, network, and unknown failures. The global mutation handler does
  not apply this query disposition rule; it separately leaves only explicitly
  coded repository-selection validation states to their owning mutation
  workflow. Other mutation failures remain reportable.
- Global query and mutation capture extras use versioned, fixed-width opaque
  fingerprints for their serialized key identities. The underlying stable
  serialization remains the React Query cache identity. The non-cryptographic
  digest is diagnostic correlation only, never a cache identity, security
  boundary, authorization input, or reversible lookup.
- The global query handler also leaves non-5xx `INVALID_FILE_PATH`,
  `FILE_NOT_FOUND`, `FILE_PERMISSION_DENIED`, and `NOT_A_DIRECTORY` AnyHarness
  responses in React Query as expected file state. A 5xx carrying any of those
  codes remains reportable, as does `PATH_OUTSIDE_WORKSPACE` unless an existing
  status rule suppresses it. Mutation disposition remains unchanged.
- Auth workflows treat only `AbortError` and the explicitly branded local
  interactive poll timeout as
  typed, rendered control states. Generic HTTP 4xx responses (including an
  unbranded 408), network failures, security failures, and unknown errors remain
  reportable.
- Sentry tags must stay low-cardinality. Prefer stable keys such as `domain`,
  `action`, `provider`, `workspace_kind`, and `route`.
- Put high-cardinality or diagnostic values in scrubbed extras, not tags.
- Background callback and deep-link error handling may capture inside the
  orchestration layer when there is no clean hook boundary, but that should be
  the exception, not the rule.

## Replay and Privacy

- Web and Mobile PostHog recording and Desktop renderer Sentry replay stay
  source-disabled: no enabling flag, options object, or start call, and
  Web/Mobile Sentry replay rates are zero. No build value, environment value,
  optional native package, or provider-side setting turns any of them on.
- Desktop PostHog recording is start-gated, not source-disabled.
  `disable_session_recording` is a literal `true` at init and there is no
  `loaded` callback, so nothing auto-starts. Recording begins only when the
  signed-in address matches the closed internal audience in
  `product-client/src/domain/telemetry/replay-audience.ts`, and only if the
  PostHog project also has replay enabled server-side. Customer recording is
  off.
- Route identifiers never reach a replay payload. Masking hides page content
  and does nothing about URLs, so URL reduction is a separate mechanism:
  `product-client/src/domain/telemetry/route-id-redaction.ts` reduces every URL
  to a bounded route template from a closed table. The load-bearing boundary is
  `before_send`, which covers every `$current_url`-style property, the rrweb
  Meta event `href`, and every URL-valued DOM attribute inside
  `$snapshot_data`. The same reducer is also wired as the recorder-boundary
  `maskAttributeFn`, but the pinned `posthog-js@1.386.8` never invokes it, so
  that boundary is dormant forward-compatibility and must not be counted as
  coverage. A pathname matching no template becomes `/unknown`.
- Widening Desktop recording to customers, or re-enabling replay on any other
  surface, requires a new reviewed source change that first proves, with
  synthetic sensitive content, the route/screen block-and-mask policy,
  metadata policy, log/network policy, provider arrival, and the absence of
  prompts, transcripts, terminal text, file contents, repo/path data, tokens,
  credentials, identity beyond the permitted opaque ID, and
  workspace/session/workflow identifiers. The rules below are its contract.
- Shared client payload scrubbing bounds container traversal by depth, array
  positions, and object properties. It replaces cyclic back-edges with
  `[circular]` and structural overflow with `[truncated]`, reuses a completed
  scrubbed value for repeated references, and redacts enumerable accessors
  without evaluating them. These are structural bounds; strings retain their
  existing redaction behavior and are not truncated by length.
- Recorder capabilities that resolve against the provider's remote flags are
  pinned in source, not left unset. Canvas recording
  (`captureCanvas: { recordCanvas: false }`) and console capture
  (`enable_recording_console_log: false`) both resolve local-first, so an unset
  value would let the PostHog project turn them on by itself. Canvas frames are
  pixels and console arguments are arbitrary strings; neither is reached by
  text masking or by route-id redaction.
- Recorded content control is masking plus blocking, and the two have
  different coverage. Desktop recording masks all text (`maskTextSelector="*"`)
  and all inputs, so rendered prompts, transcripts, terminal text, and paths
  are masked wherever they appear. `[data-telemetry-block]` removes a subtree
  entirely and is currently applied by `ProductPageShell` (when
  `telemetryBlocked` is set, as the workflows surfaces do), `SettingsScreen`,
  `ModalShell`, and `CommandPalette`. The main workspace/chat surface is masked
  but not blocked; widening replay beyond the internal audience should settle
  whether it must also be blocked.
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
