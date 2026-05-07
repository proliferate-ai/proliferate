# Frontend Copy

`copy/**` is for human-facing words and authored text.

Examples:

- titles and subtitles
- button labels
- empty-state copy
- onboarding text
- user-facing prompt templates

Prefer complete copy variants over tiny string shards. It is okay for copy to
be conditional, but the condition should usually live in domain/presentation
logic rather than in a component.

Target shape:

```text
copy/home/home-screen-copy.ts
copy/cloud/cloud-status-copy.ts
copy/plans/plan-prompts.ts
```

Copy files should not import React, stores, query clients, access helpers, or
platform APIs. They may export plain strings, string factories, and typed copy
maps when the conditions are simple and already decided by the caller.

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
