# Uploading this sync to Claude Design

Everything is built and verified; **nothing has been uploaded**. The
session that produced this was a remote (claude.ai/code) session, where
`DesignSync` cannot authorize — `/design-login` needs an interactive
terminal. So there is no Claude Design project yet and `config.json` has
no `projectId`.

Pick either route. Route A needs no local setup.

---

## Route A — from Claude Design (easiest)

1. Open **claude.ai/design**.
2. Use **"Send to Claude Code Web"**. That seeds the project *and* the
   design-system authorization into the workspace.
3. In that session, check out this branch:
   `claude/design-sync-ui-import`
4. Run `/design-sync`.

It will find `.design-sync/config.json`, rebuild deterministically, and
upload. Because a project now exists and is authorized, the only thing
left is the upload itself.

---

## Route B — locally, in a real terminal

```sh
git clone <repo> && cd proliferate
git checkout claude/design-sync-ui-import

# 1. install (Node 22 per .nvmrc; pnpm)
COREPACK_ENABLE_STRICT=0 pnpm i --frozen-lockfile

# 2. authorize Claude Design (this is the step the remote session could not do)
#    run inside an interactive Claude Code terminal:
/design-login

# 3. run the sync
/design-sync
```

`/design-sync` re-stages its scripts, reads the committed config, runs
`cfg.buildCmd`, rebuilds, validates, and uploads.

### If you'd rather drive the build by hand

```sh
# stage the converter (gitignored, so it is not in the clone)
mkdir -p .ds-sync && cp -r "<skill-dir>"/{package-build.mjs,package-validate.mjs,package-capture.mjs,resync.mjs,lib,storybook} .ds-sync/
echo '{"name":"ds-sync-deps","private":true}' > .ds-sync/package.json
(cd .ds-sync && npm i esbuild ts-morph @types/react playwright@1.56.0)

# build inputs (this is cfg.buildCmd)
COREPACK_ENABLE_STRICT=0 pnpm -F "@proliferate/product-ui..." build
node .design-sync/make-entries.mjs
node .ds-sync/node_modules/.bin/tailwindcss -i .design-sync/css/ds-source.css -o apps/packages/ui/.ds-compiled.css

# convert + verify — NOTE: absolute paths, the converter resolves against CWD
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules "$PWD/apps/packages/ui/node_modules" \
  --entry "$PWD/apps/packages/ui/.ds-entry.mjs" --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle
```

Expected: `133 component previews`, `133/133 previews render cleanly`,
exit 0, and a handful of non-blocking warns all triaged in
[NOTES.md](NOTES.md).

**playwright must be 1.56.0** if you rely on a cached chromium build
1194 (what the remote image ships). Match the installed playwright to
your own cached browser or let it install its own.

---

## About the grades

`.design-sync/.cache/` is gitignored by design, because verification
state normally becomes durable when it is uploaded — the project's
`_ds_sync.json` is what lets a later sync on any machine skip
re-verifying. **That upload never happened here**, so the 133 grade
files were force-added to git instead. Without that, a fresh clone
would re-capture and re-grade all 133 components from scratch.

Once a real upload lands, `_ds_sync.json` takes over as the anchor and
these committed copies stop mattering — they can be dropped from git at
that point.

## Two product bugs to fix independently of the upload

Both were found by rendering every component in isolation and are
verified against source. Neither blocks the sync; both affect the live
product. See NOTES.md, "Product bugs this sync surfaced":

1. `--color-warning` is an alpha fill used as ink (`text-warning`) —
   warning-toned states render near-invisible across billing, settings,
   sidebar status and four workflow branches.
2. Every highlighted fenced code block in the chat transcript collapses
   onto one line (`CodeTokenLine` emits an inline span with no newline;
   `showLineNumbers` defaults false and both transcript renderers rely
   on that default).
