# Frontend Components

Components render UI. They should be easy to scan: props in, hooks/callbacks
for behavior, JSX out.

## Ownership

- Components render. They do not fetch, orchestrate workflows, or own reusable
  product logic.
- Components may call hooks. Hooks should provide the data, callbacks, and
  state needed for rendering.
- If a component has real computation in `useMemo`, move the computation into a
  derived hook or `lib/domain` helper.
- If a component defines several callbacks that coordinate stores, query
  invalidation, navigation, or API calls, move that orchestration into a
  workflow hook.
- Use error boundaries around major sections so one crash does not kill the
  entire app.

## Folder Shape

Organize components by product ownership:

```text
components/
  ui/
    Button.tsx
    ConfirmationDialog.tsx
    ModalShell.tsx
  workspace/
    shell/
    chat/
      input/
      transcript/
    git/
  settings/
    panes/
```

Use `components/<domain>/<surface>/<role>` when a domain is large. Domain
folders should answer "what part of the product owns this?" Nested folders
should answer "what surface or role within that domain?"

Avoid new root buckets like `modals`, `panels`, `sidebar`, or `topbar`.
Domain-aware dialogs, panels, sidebars, and toolbars stay inside their owning
product area.

## UI Primitives

- Put foundational primitives and shells in `components/ui/**`.
- Do not promote product-aware components into `components/ui/**`.
- Do not render raw `<button>`, `<input>`, `<label>`, `<select>`, or
  `<textarea>` outside approved primitives in `components/ui/**`.
- Reusable icons belong in `components/ui/icons.tsx`, not inline inside
  feature components.
- Preserve UI behavior and layout unless an explicit redesign is requested.

## Component Patterns

- Functions flow down; events flow up through callbacks.
- Push state down. Lift state only when siblings need to share it.
- Split components at data boundaries: if a child needs guarded data, make the
  guard the parent and the data consumer the child.
- Use `React.memo` only when props are reference-stable and the component
  demonstrably re-renders due to parent state churn.
- Prefer focused names over generic names. A component name should describe the
  product surface or UI primitive it owns.

## Settings

- Settings routes use flat section ids.
- Visual sidebar groups, such as Configuration, are headings only and must not
  introduce nested route state.
- Settings panes live under `components/settings/panes/**`; each pane owns one
  product area.
- Repo settings compose local and cloud repo sections inside the repo pane
  instead of growing one mixed pane.
