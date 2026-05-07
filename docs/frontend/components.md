# Frontend Components

Components render UI. They should be easy to scan: props in, hook calls for
state/actions, tiny local UI callbacks, JSX out.

## Ownership

- Components render. They do not fetch, orchestrate workflows, or own reusable
  product logic.
- Components may call hooks. Hooks should provide the data, callbacks, and
  state needed for rendering.
- Components may own local presentational state that only their subtree needs.
- If a component has real computation in `useMemo`, move the computation into a
  derived hook or `lib/domain` helper.
- If a component defines several callbacks that coordinate stores, query
  invalidation, navigation, or API calls, move that orchestration into a
  workflow hook.
- Use error boundaries around major sections so one crash does not kill the
  entire app.

Allowed component logic:

- choosing which child component to render from hook-provided state
- tiny local UI callbacks such as `setOpen(false)` or forwarding an event to a
  prop callback
- local-only measurement, hover, drag, focus, and menu state
- simple formatting that is truly local and not a repeated product rule

Red flags:

- raw cloud, AnyHarness, or Tauri calls
- `queryClient.invalidateQueries`
- multiple store setters in one event handler
- duplicated product conditions across components
- non-trivial `useMemo` or `useEffect`
- inline status-to-label/tone/icon maps
- callbacks that read like workflows

## Folder Shape

Organize product components by domain, surface, then role by default:

```text
components/
  ui/
    Button.tsx
    ConfirmationDialog.tsx
    ModalShell.tsx
  workspace/
    shell/
      topbar/
      sidebar/
    chat/
      input/
      transcript/
    git/
  settings/
    panes/
```

Default path:

```text
components/<domain>/<surface>/<role>/<Component>.tsx
```

Use fewer levels only when the domain is genuinely small. Domain folders answer
"what product area owns this?" Surface folders answer "where does this render?"
Role folders answer "what part of the surface is this?"

Examples:

```text
components/workspace/chat/input/ChatInput.tsx
components/workspace/chat/transcript/MessageList.tsx
components/workspace/shell/topbar/TopBar.tsx
components/settings/panes/cloud/CloudPane.tsx
```

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
- Product copy should come from `copy/**` or a domain/presentation helper when
  it is reused or conditional.

## Component Patterns

- Functions flow down; events flow up through callbacks.
- Push state down. Lift state only when siblings need to share it.
- Split components at data boundaries: if a child needs guarded data, make the
  guard the parent and the data consumer the child.
- Use `React.memo` only when props are reference-stable and the component
  demonstrably re-renders due to parent state churn.
- Component files use `PascalCase.tsx`.
- Component names should describe the product surface or UI primitive they own.
- Avoid generic names like `Panel`, `Modal`, `Content`, or `Row` unless the
  folder path already makes the ownership unambiguous.

## Settings

- Settings routes use flat section ids.
- Visual sidebar groups, such as Configuration, are headings only and must not
  introduce nested route state.
- Settings panes live under `components/settings/panes/**`; each pane owns one
  product area.
- Repo settings compose local and cloud repo sections inside the repo pane
  instead of growing one mixed pane.
