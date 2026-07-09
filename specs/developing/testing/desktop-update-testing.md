# Desktop auto-update testing (tier 4)

How to build an N−1 desktop app that points at a local update feed, stage an N
artifact there, and watch the real Tauri auto-updater converge. This is the
tier-4 "Desktop app" mechanism from the [testing README](./README.md); read that
first for the tier model.

The shipped app is not touched. `apps/desktop/src-tauri/tauri.conf.json` keeps
its production endpoint (`https://downloads.proliferate.com/desktop/stable/latest.json`)
and production pubkey. A test build overrides only those two values (plus a
test-only insecure-transport flag) through a **build-time config overlay**, so a
build with no overlay is byte-for-byte today's config.

## The pieces

| Piece | Path | What it does |
| --- | --- | --- |
| Overlay template | `apps/desktop/src-tauri/updater-test.conf.json.template` | Checked-in. Sets only `plugins.updater.{endpoints,pubkey,dangerousInsecureTransportProtocol}` with placeholders. |
| Materializer | `apps/desktop/scripts/make-updater-test-conf.mjs` | Substitutes `UPDATER_URL`/`UPDATER_PUBKEY` into the template, writes the gitignored `updater-test.conf.json`, and refuses any template key beyond the updater allowlist. |
| Build script | `apps/desktop/scripts/build-updater-test.sh` | Generates a throwaway signing keypair (unless you bring one), materializes the overlay, runs `tauri build --config src-tauri/updater-test.conf.json`. |
| Make target | `make desktop-test-build UPDATER_URL=...` | Thin wrapper over the build script. |
| Feed server | `tests/release/scripts/serve-updater-feed.mjs` | Serves a staged artifact dir plus a `latest.json` matching the pipeline's schema. |
| Config guard | `apps/desktop/src/lib/access/tauri/updater-config.test.ts` | Merge-gate vitest: shipped config is prod byte-for-byte; overlay changes nothing else. |

## Why the overlay, not env vars

Tauri v2 merges `--config <file>` on top of `tauri.conf.json` (the same
mechanism `make dev` uses with `tauri.dev.json`). Object keys merge recursively,
so the overlay only needs the updater keys and every other field of the shipped
config is preserved. There is no env-conditional branch inside the shipped
config, so the default build cannot accidentally pick up a test endpoint.

`dangerousInsecureTransportProtocol: true` is required in the overlay because a
release build (`tauri build` is `--release`) **rejects a non-https updater
endpoint** — and a local file server is http. The flag is test-only and never
appears in the shipped config; the config guard test asserts that.

## Produce an N−1 build and drive an update

1. **Stage the N artifact.** Put the real updater tarball + detached signature
   for each target under a dir, e.g.
   `Proliferate_<N>_aarch64.app.tar.gz` and `….app.tar.gz.sig`. These come from
   a normal `tauri build` (the `.app.tar.gz` + `.sig` under
   `target/<triple>/release/bundle/macos/`), signed by the same throwaway key
   the N−1 build will trust. The signature is only verified at *download* time,
   not at `check()` time.

2. **Serve the feed** (this generates the manifest from the staged files):
   ```
   node tests/release/scripts/serve-updater-feed.mjs \
     --dir <staged-dir> --version <N> --port 8787
   ```
   `GET /latest.json` returns `{ version, pub_date, platforms: { "darwin-aarch64":
   { signature, url } } }` — the same schema `scripts/generate-updater-manifest.mjs`
   publishes in CI.

3. **Build the N−1 app** pointed at that feed. Set the desktop
   `version` in `apps/desktop/src-tauri/tauri.conf.json` to N−1 first (or check
   out the N−1 tag), then:
   ```
   make desktop-test-build UPDATER_URL=http://127.0.0.1:8787/latest.json
   ```
   The build prints the throwaway pubkey it trusted; that same key must have
   signed the staged N artifact. To reuse a fixed key across the N−1 build and
   the N artifact, pass `UPDATER_PUBKEY` + `TAURI_SIGNING_PRIVATE_KEY` +
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to both instead of letting the script
   generate one.

4. **Drive the update.** The updater UX is **user-gated**: a 30-minute poll (or
   the Settings → "Desktop updates" action, `checkForUpdates`) surfaces a toast,
   the user accepts to download, and a restart dialog completes the swap. A GUI
   test must click that chain. The app wraps the plugin's JS API in
   `apps/desktop/src/lib/access/tauri/updater.ts` (`checkForUpdate` →
   `check()`, `downloadAndInstall`, `relaunch`) — a test build can call these
   directly to skip the manual toast.

## Proving `check()` without the full GUI

`tauri_plugin_updater`'s `check()` (fetch manifest, semver-compare current vs
served) can be exercised headlessly against the feed with a tiny harness built on
`tauri::test::mock_app()` — no window, no sidecars, no signing:

```rust
let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
ctx.config_mut().plugins.0.insert("updater".into(), serde_json::json!({
    "endpoints": [endpoint], "pubkey": "",
    "dangerousInsecureTransportProtocol": true
}));
let app = tauri::test::mock_builder()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .build(ctx).unwrap();
let updater = app.handle().updater_builder()
    .endpoints(vec![endpoint.parse()?])?.build()?;
let update = updater.check().await?; // Some(_) when served version > mock's 0.1.0
```

The mock app reports package version `0.1.0`, so a feed serving `>0.1.0` yields
`Some(update)` and `<=0.1.0` yields `None`. This is the cheapest faithful
`check()` assertion; full download/install still needs the real bundle.

## Gotchas for the tier-4 test

- **`dangerousInsecureTransportProtocol` is mandatory for http feeds** — a
  release build silently refuses a non-https endpoint otherwise. The overlay
  already carries it; if you point at an https tunnel it is harmless.
- **Signature timing:** `check()` does not verify the signature; `downloadAndInstall`
  does. A malformed/missing `.sig` still lets `check()` report the update but
  fails the install — so a full upgrade test needs the staged artifact signed by
  the key the N−1 build trusts.
- **Sidecars are stubbed locally.** `apps/desktop/src-tauri/binaries/*` are
  placeholder shell scripts in a dev checkout; a test build bundles those, which
  is fine for exercising the *updater* but not the agent runtime.
- **Target key is `darwin-aarch64`** (Tauri maps macOS → `darwin`), matching the
  production manifest generator.
- The materialized `updater-test.conf.json` is gitignored; only the `.template`
  is committed. Never commit a real endpoint override.
