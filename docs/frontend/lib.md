# Frontend Lib

`lib/**` is for non-component logic. Keep React behavior in hooks and raw
external access in `lib/access/**`.

## `lib/domain/**`

Pure product logic.

Use this for rules that understand Proliferate concepts but do not need React,
stores, query clients, platform APIs, or external clients.

Examples:

- chat surface mode transitions
- session status labels
- workspace display names
- prompt outbox reconciliation
- validation rules for product models

Rules:

- No React, JSX, hooks, stores, query clients, telemetry, or raw access.
- Keep functions deterministic when possible.
- Organize large domains by subdomain and product purpose, not by generic file
  types like `utils` or `helpers`.

Target shape:

```text
lib/domain/
  chat/
    surface/
    transcript/
    prompt-outbox/
  sessions/
  workspaces/
```

## `lib/workflows/**`

Plain non-React product sequences.

Use this when logic coordinates multiple dependencies but should not be tied to
React. The hook gathers dependencies and passes them in; the workflow runs the
sequence.

Examples:

- create workspace then create initial session
- prepare prompt payload then dispatch
- reconcile materialized workspace metadata

Rules:

- No React hooks.
- Dependencies are passed in as arguments.
- Keep side effects explicit in the dependency interface.
- Workflow hooks should remain thin controllers around these functions.

## `lib/infra/**`

Generic technical machinery that does not care about product domains.

Examples:

- persistence helpers
- scheduling and batching
- ids and stable key helpers
- measurement plumbing
- safe JSON parsing
- logging utilities

If a function knows about chats, sessions, workspaces, agents, billing, or
repositories, it is not infra.

## `config/**`

Real static configuration: constants, limits, option sets, route ids, default
ids, ordering, and runtime-independent knobs.

Good examples:

- route ids
- maximum composer rows
- known provider ids
- ordered settings sections
- runtime default constants

Do not put human-facing copy or presentation mappings here.

## `copy/**`

Human-facing words and authored text.

Examples:

- titles and subtitles
- button labels
- empty-state copy
- onboarding text
- user-facing prompt templates

Prefer complete copy variants over tiny string shards. It is okay for copy to
be conditional, but the condition should usually live in domain/presentation
logic rather than in a component.

## Presentation Mappings

Presentation mappings convert product state to display metadata: labels, tones,
icons, descriptions, ordering, and visibility flags.

Put reusable mappings in `lib/domain/<domain>/<subdomain>/presentation.ts`.
Keep them component-local only when they are purely visual and not reused.

Examples:

- cloud workspace status -> label/tone/description
- session control -> display label/icon
- agent availability -> badge tone

Presentation mappings are not access logic and are not remote caches.
