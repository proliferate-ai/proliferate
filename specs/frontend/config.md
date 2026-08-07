# Frontend Config

`config/**` is for real static configuration: constants, limits, option sets,
route ids, default ids, ordering, and runtime-independent knobs.

Good examples:

- route ids
- maximum composer rows
- known provider ids
- ordered settings sections
- runtime default constants

Do not put human-facing copy or presentation mappings here.

File naming should name the constant area, not the component using it:

```text
config/app-routes.ts
config/chat-layout.ts
config/runtime.ts
config/shortcuts.ts
```

Keep config values static. If a value depends on runtime state, user settings,
remote data, or a selected workspace/session, it belongs in a hook, store,
domain helper, or access layer instead.
