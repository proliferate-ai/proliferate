# Terminals

Status: authoritative for user-facing workspace terminal behavior on Desktop.
Runtime terminal internals (PTY lifecycle, output sinks, command runs) are
owned by the AnyHarness structure specs under
[../../../structures/anyharness/README.md](../../../structures/anyharness/README.md).

## Surfaces

- Right panel terminal pane: `apps/desktop/src/components/workspace/terminals/`
  (`TerminalPanel`, `TerminalViewport`, `TerminalTopBar`), mounted from
  `components/workspace/shell/right-panel/RightPanelContent.tsx`.
- Record actions (create/close/rename/resize/run):
  `hooks/terminals/workflows/use-terminal-actions.ts` and pure workflows in
  `lib/workflows/terminals/terminal-record-workflows.ts`.
- Rendering and stream lifecycle: `hooks/terminals/lifecycle/`
  (`use-xterm-surface.ts`, `use-terminal-viewport.ts`) over
  `lib/infra/terminals/terminal-stream-registry.ts`.

## Creation Grid Contract

A terminal PTY must be created with the exact cols/rows the xterm renderer
will display. The shell prints its first prompt immediately after spawn; zsh
prefixes every prompt with the PROMPT_SP sequence (`%` + COLUMNS−1 spaces +
CR), which is invisible only when the emit width equals the render width. A
mismatched creation grid shows a stray `%` line at the top of new terminals
and mis-wraps anything printed before the first resize.

Operating rules:

- Elements that host a terminal viewport advertise the workspace they render
  with the `data-terminal-grid-probe` attribute (value = workspaceId). Both
  the right-panel content root and the terminal panel content box carry it so
  a grid is measurable before the first terminal in a pane is visible.
- Terminal creation resolves the grid via
  `lib/infra/terminals/terminal-grid-probe.ts`, which measures an offscreen
  xterm using the same renderer options as the live surface (font family from
  `lib/domain/terminals/terminal-grid.ts`, font size from the readable-code
  preference). Identical options are mandatory: cell metrics drive cols/rows.
- `DEFAULT_TERMINAL_GRID` (120×40) is a fallback for when no probe target is
  laid out (hidden shells, headless callers). Do not pass literal dimensions
  from UI call sites.
- The first fitted resize after attach still reconciles the PTY
  (`use-terminal-viewport.ts` → `resizeTab`); the probe makes that resize a
  no-op in the common case rather than a correction.

## Acceptance

- Opening the first terminal in a workspace pane shows a clean prompt: no
  leading `%`, no leading blank line, prompt on row one.
- Subsequent terminals and reopened terminals replay history without
  re-wrapping artifacts at the top.
- Terminals still open (at the default grid) when the pane is not measurable.
