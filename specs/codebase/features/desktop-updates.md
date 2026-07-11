# Desktop Updates And Release Notices

Status: authoritative for the packaged Desktop updater, its sidebar release
notice, and the version-specific metadata published on the Desktop downloads
CDN.

Read this spec with
[`ci-cd.md`](../../developing/deploying/ci-cd.md) and
[`desktop-update-testing.md`](../../developing/testing/desktop-update-testing.md).
The CI/CD spec owns packaging, signing, publishing, and operator procedure; the
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
- The compact update pill remains an operational indicator.
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
by [`ci-cd.md`](../../developing/deploying/ci-cd.md).

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

## Implementation Ownership

- Release manifest generation and CDN publication:
  `scripts/generate-updater-manifest.mjs`,
  `.github/workflows/release-desktop.yml`, and `apps/desktop/infra/main.tf`.
- Raw Tauri and downloads access: `apps/desktop/src/lib/access/**`.
- React Query ownership for immutable manifests:
  `apps/desktop/src/hooks/access/**`.
- Pure selection and normalization: `apps/desktop/src/lib/domain/updates/**`.
- Persistence and UI-facing orchestration: `apps/desktop/src/hooks/updates/**`.
- Presentation: `apps/desktop/src/components/workspace/shell/sidebar/**`.
