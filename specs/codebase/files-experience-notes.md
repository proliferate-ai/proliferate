# Files experience — how it works (2026-07-04, PRs #927/#930/#931)

My mental model, from building it:

- One rendering primitive now. product-ui `src/code/` (CodeTokenLine, CodeBlock, code-theme-tokens) renders pre-tokenized lines; file viewer, chat code blocks, rich preview, diffs all consume it. Shiki stays in desktop because it's heavy (WASM + grammars) and web consumers of product-ui shouldn't inherit it — desktop tokenizes, product-ui just paints tokens. That's also what killed the `[&_.shiki]` cross-package CSS hack.
- The viewer was ALWAYS virtualized (tanstack react-virtual). The perf fix was deleting an O(n) whole-file widest-line scan — intrinsic `w-max` sizing derives scroll width from painted rows instead.
- File browser = Codex-style floating overlay (right-anchored, over the code, Escape/outside-click), NOT a persistent sidebar — I corrected this from the real Codex screenshots mid-build. Filter results render as a grouped directory tree, not a flat list.
- Filter search hits the pre-existing runtime `GET /files/search` — zero backend work in all three PRs. Overlay width persists (zustand→localStorage); open/closed is deliberately session-only.

What surprised me:
- Our `text-xs` token is 8px. It made 14px chevrons look comically huge and claimed four separate victims. Never use it in files surfaces; explicit `text-[12px]`/`text-[13px]`.
- Full-bleed icon glyphs (vendored Material set, Lucide) read ~1 step bigger than Codex's padded glyphs at the same px — render one size down.
- Editing is ~90% built and 0% exposed: runtime write/CRUD with version tokens, SDK mutations, dirty-buffer store all exist; an "edit" viewer mode was scaffolded then stripped in `normalizeFileViewerMode` (viewer-target.ts). CodeMirror-in-edit-mode is the agreed future shape.

Open: editing v2, workspace grep (needs new Rust endpoint), tabs/preview-pin semantics, filter-tree indent depth nit.
Key files: FileTreeOverlay.tsx, FileViewerFrame.tsx, product-ui/src/code/, lib/domain/files/file-search-tree.ts.
