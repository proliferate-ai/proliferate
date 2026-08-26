# Desktop Updates And Release Notices

Read this spec with
[`releases.md`](../../../guides/deploying/releases.md) and
[`desktop-update-testing.md`](../testing/desktop-update-testing.md).
The Releases procedure owns packaging, signing, publishing, and operator procedure; the
testing spec owns the real N−1 to N updater mechanism; this feature spec owns
user-visible update and release-notice behavior.

## Product Contract

The Desktop updater manifest is the release-notice source consumed by the app.
It keeps the standard Tauri updater shape and may add one optional field:

```json
{
  "version": "0.3.25",
  "notes": "Introducing Grok",
  "pub_date": "2026-07-12T00:00:00Z",
  "platforms": {}
}
```

- `version` is the exact Desktop version advertised or installed.
- `notes`, when present, is the release-notice title. It is plain text, one
  line, trimmed, and no longer than 80 characters.
- The title does not contain Markdown or HTML and is never rendered as either.
- The notice destination is always
  `https://proliferate.com/changelog`; the manifest does not provide a URL.
- A manifest without a valid `notes` title remains a valid updater manifest
  and produces no release-notice card.

The downloads CDN publishes the same manifest at two identities:

- `desktop/stable/latest.json` is the rolling updater feed.
- `desktop/stable/<version>/latest.json` is the immutable installed-version
  record.

The rolling feed answers which version is available. The immutable record
answers which titled release is currently installed, including after an
in-app upgrade, a manual DMG upgrade, or a fresh install.

## Notice Selection

The sidebar derives notices from the running version only:

1. Resolve the exact installed app version.
2. Read `desktop/stable/<installed-version>/latest.json`.
3. Show its valid title unless that installed version was acknowledged.
4. Otherwise, show no release notice.

The rolling updater feed exposes its valid `notes` value through updater state.
The morphing update toast uses `UPDATE` plus that authored headline throughout
available, downloading, and ready phases while its operational status and
Download/progress/Restart controls change. An untitled manifest retains the
generic updater copy. An available target never produces a sidebar
release-notice card; the updater toast is its single announcement surface.

Installed versions are compared as exact strings after transport
normalization. A response fetched from a versioned manifest path is rejected
when its `version` does not match the requested version.

Release-notice persistence stores `acknowledgedReleaseVersion` for the
currently installed release. Closing the installed card or successfully
opening its changelog records that exact version. Update checking, downloading,
installation, restart, and available-target changes do not modify this
acknowledgment, so an acknowledged installed notice cannot be resurrected by
later updater activity.

The app caches the current valid version/title pair as an offline fallback.
Transport failure, malformed JSON, a mismatched version, or a missing title
must fail quiet and must never block update checking, installation, relaunch,
or the rest of the sidebar.

## Updater UX Boundary

The packaged Desktop updater remains a user-gated flow:

- Settings → Desktop updates starts an explicit update check.
- The sidebar footer control remains the persistent operational indicator. It
  sits immediately left of help, wears the same square accent footprint, and
  carries no progress of its own.
- The update toast owns the pre-install announcement: a valid authored title
  stays visible while its download action, progress, and restart action morph.
  It also owns recoverable update errors.
- The existing restart dialog owns completion of an installed update.
- The release-notice card appears only after a titled version is running. It
  supplies changelog context and never duplicates availability, download,
  progress, restart, or error controls.

The headless T4 scenario proves manifest selection, signature verification,
and bundle replacement. Focused renderer tests and a packaged-WebView smoke
prove the user-visible notice states and interactions.

## Sidebar Presentation

The release-notice card renders immediately above the sidebar account footer.

- The installed-version notice uses the eyebrow `NEW`.
- The authored title is the card headline.
- The sole content action is `Changelog →` and opens the fixed external URL.
- A close affordance is keyboard accessible and has an explicit accessible
  label.

The card uses sidebar semantic tokens, tolerates an 80-character title without
overflow, and is absent when the sidebar is collapsed.

## Release Operation

`release_title` is an optional Desktop release input. Named launches provide
it; unattended and routine releases may omit it. Manifest generation validates
the title before any updater asset is published. The same generated JSON is
then uploaded to both rolling and immutable manifest keys.

The rolling and immutable records for a version must carry the same authored
title. The packaged WebView must be able to fetch the immutable record from the
public downloads CDN. Direct tag-push releases without an authored input remain
valid and publish without `notes`. Atomic publication order, collision handling,
same-version reruns, CORS configuration, and partial-publish recovery are owned
by [`releases.md`](../../../guides/deploying/releases.md).

## Acceptance Matrix

| Scenario | Required result |
| --- | --- |
| Titled update is available | Update toast shows `UPDATE` and the authored title with Download; the sidebar shows no notice for that target. |
| Titled update is downloading or ready | The toast keeps the authored title visible while showing progress or Restart. |
| Update installs and app relaunches | Sidebar shows `NEW` and the installed title. |
| Installed card is closed | That installed version does not reappear. |
| Changelog is opened | Fixed changelog URL opens and that version is acknowledged. |
| Installed release was acknowledged before newer targets | Updater activity does not resurrect the installed notice. |
| Fresh install has titled versioned manifest | Sidebar shows `NEW` once the normal app shell is available. |
| Manifest omits `notes` | Existing updater UI works and no release card renders. |
| Versioned response version mismatches | Response is ignored and cached valid data may be used. |
| CDN is unavailable | App and updater remain usable; cached valid title may render. |
| N-1 to N packaged upgrade | No target sidebar card appears before install; the installed title appears once after relaunch. |

## Owned Download, Staging, And Verification

The download is owned Rust-side rather than delegated to the updater plugin.
The plugin cannot abort or resume, holds the whole download in memory,
persists nothing, has no default timeout, and its `Update::install(bytes)`
seam performs no signature verification. The owned path (default on) addresses
each of these; the plugin path stays wired underneath and is restored by
turning the flag off.

Native commands live in `apps/desktop/src-tauri/src/updater_owned.rs`:

- `updater_owned_check` builds the updater via the plugin's updater builder,
  optionally overriding the endpoint, and stores the resulting `Update` in the
  resources table. The baked minisign public key from `tauri.conf.json`
  verifies the artifact no matter which endpoint served the manifest.
- `updater_owned_download` streams the artifact to
  `<app_data_dir>/updates/staged/<version>.tar.gz.partial` with a 10s connect
  timeout and a per-read inactivity guard, resuming an existing partial with a
  `Range` request only when the server answers 206, computes sha256, verifies
  minisign over the file bytes, renames to the final staged name, and writes a
  `<version>.staged.json` sidecar recording version, sha256, byte length,
  signature, and stage time. A managed cancellation token enforces a single
  live download.
- `updater_owned_abort` cancels the in-flight download, which returns a typed
  `UPDATER_DOWNLOAD_ABORTED`. A retry aborts and awaits the ack before starting
  a new download, so there is never more than one live download.
- `updater_staged_status` returns the staged identity only when the file still
  hashes to its sidecar and minisign verifies; any mismatch deletes the
  artifact and sidecar and returns nothing.
- `updater_owned_install` re-verifies the staged bytes and installs them; the
  Worker teardown ordering runs first, in the renderer wrapper, before install.

The renderer state machine (`hooks/access/tauri/updater-*.ts`, driving
`stores/updater/updater-store.ts`) adds `verifying` (bytes staged, sha256 and
minisign being re-checked) and `reusingStaged` (a verified artifact for the
offered version was found at check time, so nothing is downloaded). In the
owned path `ready` means staged and verified, and the install runs at restart;
the legacy path installs during download and `ready` means installed.

Persistence uses the existing `updater_metadata` key additively:
`{lastCheckedAt, skippedVersions, availableVersion?, staged?}`. The skip list is
hydrated on boot so a skipped version is never re-announced after relaunch, and
a persisted staged pointer that no longer matches the offered version is
dropped.

Two client-local flags gate the behavior (`hooks/access/tauri/updater-flags.ts`,
persisted under `updater_flags`): `ownedUpdaterEnabled` defaults on and
`updaterServerRedirectEnabled` defaults off. When the redirect flag is on and a
non-official server is connected, the owned check points at that server's
`/desktop/updater/latest.json`; any failure falls back to the baked feed. The
server may additively supply cadence overrides on `/meta` under `desktopUpdater`
(`checkIntervalMs`, `stallThresholdMs`), consumed tolerantly.

Typed native errors are `UPDATER_CHECK_FAILED`, `UPDATER_DOWNLOAD_STALLED`,
`UPDATER_DOWNLOAD_ABORTED`, `UPDATER_ARTIFACT_HASH_MISMATCH`,
`UPDATER_INSTALL_FAILED`, and `UPDATER_DISK_FULL`.

## Version-Skew Enforcement

`GET /meta` (`server/proliferate/server/meta.py`) reports `minDesktopVersion`
(the floor the operator's server accepts) alongside a separate
`minDesktopVersionEnforced` boolean. `minDesktopVersion` defaults to the
server's own stamped desktop version — so its mere presence can never be the
block signal, or every slightly-stale client would be locked out the moment
enforcement shipped. Blocking requires the operator to explicitly set
`ENFORCE_MIN_DESKTOP_VERSION=true` (`server/proliferate/server/version.py`);
default is permissive (warn-only), matching this ADR's "server-config-driven,
defaults permissive" gate.

On the desktop, `useMinDesktopVersionGate`
(`apps/packages/product-client/src/hooks/access/cloud/server-capabilities/use-min-desktop-version-gate.ts`)
polls `/meta` for the currently connected server (boot-time and every 60s, not
just the one-shot check the manual connect-server flow already ran) and
renders `MinDesktopVersionGate` — a full-screen takeover cloned from
`BootstrappedRoute`'s gating pattern, mounted above the workspace outlet in
`App.tsx` — only when all of: the server explicitly enforces, the desktop's own
version is confidently older
(`isDesktopVersionSupported`, which fails open on dev/unstamped sentinels and
unparseable strings), and the server actually declared a well-formed `/meta`.
A self-hosted server that fails the structural shape check, or omits the
fields entirely (older server), never blocks. The takeover blocks the *user*,
not the runtime: background sessions keep executing beneath it. It never
covers the sign-in/connect surface, and it carries a "Sign out and switch
server" escape hatch, so a misconfigured self-hosted floor (one no published
desktop build can satisfy) can strand a session but never the app. A `desktop_minversion_block`
telemetry event fires once per transition into the blocked state; a
`desktop.minversion.block_rate` server-side dashboard is a follow-up, not built
here.

Separately, the native shell asserts the AnyHarness sidecar's own version at
boot — see [`desktop-native.md`](../../systems/desktop-host/desktop-native.md#boot-flow) for
`runtime_version_assert` and `PROLIFERATE_RUNTIME_VERSION_ASSERT`. That is an
app-shell-to-sidecar check; this section is the desktop-app-to-server check.

## Implementation Ownership

- Release manifest generation and CDN publication:
  `scripts/generate-updater-manifest.mjs`,
  `.github/workflows/release-desktop.yml`, and `apps/desktop/infra/main.tf`.
- Owned native download, staging, and verification:
  `apps/desktop/src-tauri/src/updater_owned.rs`.
- Raw Tauri and downloads access: `apps/desktop/src/lib/access/**`.
- React Query ownership for immutable manifests:
  `apps/desktop/src/hooks/access/**`.
- Pure selection and normalization: `apps/desktop/src/lib/domain/updates/**`.
- Persistence and UI-facing orchestration: `apps/desktop/src/hooks/updates/**`.
- Presentation: `apps/desktop/src/components/workspace/shell/sidebar/**`.
- Version-skew gate: `apps/packages/product-client/src/hooks/access/cloud/server-capabilities/use-min-desktop-version-gate.ts`,
  `apps/packages/product-client/src/components/auth/MinDesktopVersionGate.tsx`,
  `server/proliferate/server/{meta,version}.py`.
- Restart dialog interrupted-work list:
  `apps/packages/product-client/src/hooks/app/lifecycle/use-running-agent-summaries.ts`,
  `apps/packages/product-client/src/components/feedback/UpdateRestartDialog.tsx`.
