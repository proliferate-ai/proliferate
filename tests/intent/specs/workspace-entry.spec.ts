// T2-WS-2 (specs/developing/testing/scenarios.md): local + worktree create
// (desktop-web limits apply).
//
// Scenario text: "Local/worktree creation drive the local AnyHarness runtime
// and OS file pickers — partially Tauri-bound. Tier 2 asserts only what web
// mode can reach: the Add-Repo flow branches (add-repo-flow-store.ts) render
// and validate inputs. Full local/worktree creation is asserted in tier 3's
// desktop lane."
//
// SPEC DIVERGENCE, flagged for the record: the scenario's title and body
// both name "worktree create" as in-scope for the Add-Repo flow, but as
// built the Add-Repo flow (add-repo-flow-store.ts's AddRepoFlowStoreStep,
// AddRepoFlow.tsx) has exactly two entry branches — "cloud" and
// "add-existing-folder" — there
// is no "worktree" option anywhere in this flow. Worktree creation is a
// wholly separate action: the sidebar's per-repo "New workspace" button
// (SidebarRepositoriesHeader / use-workspace-sidebar-actions.ts ->
// createWorktreeWorkspace), a single click with no input form at all — name,
// branch, and base ref are all auto-generated
// (resolveWorktreeCreationParams, workspace-creation.ts) unless the caller
// passes overrides, which the sidebar entry point never does. There is
// nothing to "render and validate inputs" on for worktree creation even in
// principle: the UI surface is one button, not a form.
//
// Beyond the Tauri file-picker gap this scenario names, worktree (and local)
// creation also unconditionally drives the local AnyHarness runtime
// (ensureRuntimeReady in add-repo-workflow.ts / use-workspace-actions.ts).
// This suite's CI profile explicitly disables that runtime
// (TIER2_INTENT_SKIP_RUNTIME=1, stack/boot.ts — building the Rust binary
// from scratch per-PR is too slow) — so even a seam-only assertion of
// "clicking New workspace starts a real worktree creation call" would be
// flaky-by-construction in CI (no runtime to answer it) while passing
// locally, which is worse than not testing it. Resolving scenarios.md's own
// open ruling #3 ("is seam-only coverage of local/worktree create acceptable
// for tier 2?") the way this spec reads it: yes for the Add-Repo entry
// surface (below), and worktree creation specifically is out of scope for
// tier 2 entirely, deferred to tier 3's desktop lane per the scenario's own
// fallback framing — not a thin seam, a real gap this wave names rather than
// silently skips.
//
// What IS testable in desktop-web, and is tested below: the Add-Repo flow's
// entry step is host-truthful. AddRepoFlowHost derives its entry options from
// the host's file access (`host.desktop?.files`) — the Desktop host offers
// "Add an existing folder" + "Set up in Cloud"; the genuine Web host offers
// only "Set up in Cloud".
//
// CRITICAL — which host this suite actually boots: stack/boot.ts serves
// `apps/desktop` over a Vite web port ("desktop web build"), NOT `apps/web`.
// The desktop app unconditionally mounts DesktopHostProviders ->
// DesktopProductHostProvider, which yields `surface: "desktop"` and a non-null
// `host.desktop = desktopBridge`. `desktopBridge.files` is a static,
// always-present adapter (apps/desktop/src/lib/access/tauri/desktop-bridge.ts),
// so `host.desktop?.files` is truthy and AddRepoFlowHost computes
// `options === ["add-existing-folder", "cloud"]` — BOTH options render. Only
// the real Web bundle (apps/web/src/web-host.ts) sets `desktop: null` and
// collapses to `["cloud"]`; that bundle is not what this suite boots, and its
// cloud-only contract is pinned by unit tests instead
// (apps/packages/product-ui/test/AddRepoFlow.test.tsx "offers only Set up in
// Cloud on Web", apps/web/src/web-host.test.tsx "surface web and desktop null").
//
// So the host-truthful assertion for THIS booted client is: both the local and
// the cloud entry options are present, because the client is the Desktop host
// served over HTTP. The concrete "desktop-web limits apply" behavior the
// scenario names is a *runtime* limit, not an option-visibility one: the local
// "Add an existing folder" option renders, but its native folder picker
// (pickFolder -> Tauri `invoke("pick_folder")`, shell.ts) is unavailable over a
// plain browser. The Desktop bridge reports that unavailable transport
// separately from a normal user cancellation, so clicking it explains that
// the native Desktop app is required rather than silently doing nothing.
// Picking the cloud option navigates to a real render branch that, on this
// operator-incomplete deployment (boot.ts seeds no
// GITHUB_APP_* config, so /meta serves both cloud capabilities "disabled" per
// capability-contract.spec.ts's T2-SH-5), surfaces the truthful
// operator-configuration blocker via AddRepoFlowHost's shared-resolver
// preflight (PR2-GATING-01) — NOT the older "Authorize GitHub App" user-auth
// CTA a user could never act on when the operator never configured the App.

import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, ensureInstanceClaimed, webBaseUrl } from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

async function signInThroughUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto(webBaseUrl());
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/**
 * The sidebar (which owns the "Add repository" action) defaults to
 * collapsed on a fresh profile — StandardWorkspaceShell renders a
 * "Show sidebar" toggle in its place (`sidebarOpen` false-by-default,
 * apps/desktop/src/components/workspace/shell/screen/StandardWorkspaceShell.tsx).
 * Expand it once per test so "Add repository" is actually reachable, not
 * just present-but-off-screen in a collapsed panel (verified: clicking
 * straight at "Add repository" without this first hangs forever — the
 * button resolves via role query but the sidebar container has zero width).
 */
/**
 * Wait for the "Add repository" control to reach a settled, interactable
 * layout — not merely to exist in the DOM. This is the deterministic
 * readiness gate the width transition demands.
 *
 * The sidebar container animates `width: 0 -> target` over
 * `transition-[width] duration-150 ease-in-out` with `overflow-hidden`
 * (WorkspaceShellSidebar.tsx). Two things make a naive "toggle flipped, now
 * click" sequence flaky on cold starts:
 *   1. The "Hide sidebar" toggle flips synchronously when `sidebarOpen`
 *      becomes true — i.e. at t=0 of the width animation, before the panel
 *      has any usable width. Asserting the toggle proves the state changed,
 *      not that the layout settled.
 *   2. Playwright reports the clipped "Add repository" button as `visible`
 *      (it ignores ancestor `overflow-hidden` clipping), and its built-in
 *      pre-click stability check only compares two animation frames — a
 *      window `ease-in-out`'s near-zero opening velocity can satisfy while
 *      the panel is still expanding. A click then lands on a control that is
 *      still clipped/shifting, the popover never opens, and the test times
 *      out on the "Add a repository" heading (observed as the retry-#1
 *      failure on the exact-head Actions run for this spec).
 *
 * So gate on the button's own geometry: poll getBoundingClientRect until it
 * is positive-width, fully inside the viewport, and unchanged across a
 * sample gap wider than the 150ms transition, and confirm the button is the
 * top hit-test element at its center (nothing is painting over it). No
 * `force`, no fixed sleeps standing in for readiness, and — critically — no
 * retry of the product action itself.
 */
async function waitForAddRepoButtonSettled(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Add repository" })
    .evaluate(async (node) => {
      const TRANSITION_SETTLE_MS = 200; // > the 150ms width transition
      const raf = () =>
        new Promise<number>((resolve) => requestAnimationFrame(() => resolve(performance.now())));

      const stableBox = async () => {
        // Sample, wait past the transition window, sample again; require the
        // box to have stopped moving/growing before we trust it.
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const first = node.getBoundingClientRect();
          const start = await raf();
          // Spin frames until the settle window elapses.
          let now = start;
          while (now - start < TRANSITION_SETTLE_MS) {
            now = await raf();
          }
          const second = node.getBoundingClientRect();
          const settled =
            first.width > 0 &&
            Math.abs(first.left - second.left) < 0.5 &&
            Math.abs(first.top - second.top) < 0.5 &&
            Math.abs(first.width - second.width) < 0.5 &&
            second.right <= window.innerWidth &&
            second.left >= 0 &&
            second.bottom <= window.innerHeight &&
            second.top >= 0;
          if (settled) return second;
        }
        throw new Error("Add repository control did not settle into a stable, in-viewport box");
      };

      const box = await stableBox();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const topAtCenter = document.elementFromPoint(cx, cy);
      if (!(topAtCenter && (topAtCenter === node || node.contains(topAtCenter)))) {
        throw new Error("Add repository control is not the top hit-test element at its center");
      }
    });
}

async function ensureSidebarOpen(page: Page): Promise<void> {
  const showSidebarButton = page.getByRole("button", { name: "Show sidebar" });
  const hideSidebarButton = page.getByRole("button", { name: "Hide sidebar" });
  // The shell mounts asynchronously after the auth gate clears. An instant
  // isVisible() here raced that mount on cold starts (the first test of a CI
  // run): the check missed while the shell was still booting, the expand was
  // skipped, and the "Add repository" click then hung forever against the
  // zero-width collapsed sidebar (the button is in the DOM either way — see
  // the note above). Wait for whichever toggle state the shell settles into
  // before deciding whether to expand.
  await expect(showSidebarButton.or(hideSidebarButton).first()).toBeVisible({
    timeout: 60_000,
  });
  if (await showSidebarButton.isVisible().catch(() => false)) {
    await showSidebarButton.click();
    // Prove the sidebar actually expanded, not just that the click landed.
    await expect(hideSidebarButton.first()).toBeVisible();
  }
  // The toggle flip above is synchronous with the start of the width
  // animation; wait for the Add-repository control to actually reach a
  // stable, clickable layout before any caller clicks it.
  await waitForAddRepoButtonSettled(page);
}

async function openAddRepoFlow(page: Page): Promise<void> {
  await ensureSidebarOpen(page);
  await page.getByRole("button", { name: "Add repository" }).click();
}

async function expectEntryStepVisible(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Add a repository" })).toBeVisible();
  // This suite boots the Desktop host (apps/desktop) over a web port, so
  // `host.desktop?.files` is truthy and AddRepoFlowHost offers BOTH options
  // (options === ["add-existing-folder", "cloud"]). Assert both are present:
  // that is the host-truthful contract for the Desktop client. (The genuine
  // Web bundle's cloud-only contract is pinned by unit tests — see the header.)
  await expect(page.getByRole("button", { name: "Set up in Cloud" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add an existing folder" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await ensureInstanceClaimed();
  await signInThroughUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  // Same app-shell render proof auth.spec.ts's expectSignedInAppShell uses:
  // past the auth gate, the login form is gone. Deliberately NOT asserting
  // on "Add repository" here — its containing sidebar panel collapses to
  // zero width by default (see ensureSidebarOpen below) rather than
  // unmounting, so the button stays `visible` by Playwright's CSS-only
  // definition even while functionally unreachable; it is not a reliable
  // "the shell is up" signal on its own.
  await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
});

test.describe("T2-WS-2: local + worktree create (desktop-web limits apply)", () => {
  test("Add-Repo entry step is host-truthful: the Desktop host (this suite's client) offers both local and cloud", async ({ page }) => {
    await openAddRepoFlow(page);
    await expectEntryStepVisible(page);
  });

  test("desktop-web limit: clicking Add an existing folder explains that the native Desktop app is required", async ({ page }) => {
    // The local "Add an existing folder" option is present on this booted
    // Desktop host, but its native folder picker (pickFolder -> Tauri
    // `invoke("pick_folder")`, lib/access/tauri/shell.ts) is unreachable over a
    // plain browser. The bridge distinguishes that transport gap from a native
    // user cancellation, so the entry step must explain how to continue.
    await openAddRepoFlow(page);
    await expectEntryStepVisible(page);

    await page.getByRole("button", { name: "Add an existing folder" }).click();

    await expect(page.getByRole("alert")).toHaveText(
      "Open the Desktop app to choose a local folder.",
    );
    await expect(page.getByText(/^Added /)).toHaveCount(0);

    // No crash: the entry step is still mounted and interactable after the
    // unavailable-picker result (the dialog did not tear itself down or throw).
    await expect(page.getByRole("heading", { name: "Add a repository" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Set up in Cloud" })).toBeVisible();
  });

  test("cloud branch shows the truthful operator-configuration blocker (PR2-GATING-01), never a user-auth CTA the operator gap makes unactionable", async ({ page }) => {
    // This suite's t2intent stack seeds NO GitHub App runtime config — boot.ts
    // sets no GITHUB_APP_* env, so this self-managed deployment's /meta serves
    // githubRepositoryAccess.status="disabled" and managedCloud.status="disabled"
    // (capability-contract.spec.ts T2-SH-5 pins exactly this "add-ons off"
    // contract). The deployment is therefore operator-INCOMPLETE.
    //
    // Before PR2-GATING-01 the cloud step still offered "Authorize GitHub App"
    // — the exact misleading CTA (a user cannot repair a deployment the
    // operator never configured) this PR exists to eliminate. AddRepoFlowHost's
    // shared-resolver preflight now stops at gate 1 (operator capability
    // disabled) and replaces that CTA with the truthful operator explanation,
    // which carries NO action button (describeReadinessBlocker returns
    // actionLabel/onAction null for the operator gate).
    await openAddRepoFlow(page);
    await expectEntryStepVisible(page);

    await page.getByRole("button", { name: "Set up in Cloud" }).click();
    await expect(page.getByRole("heading", { name: "Add a cloud repo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();

    // The truthful operator blocker (CloudRepoPickerBlocker renders blocker.title
    // as an <h3>). With no GitHub App slug configured, the null-displayName copy
    // is used.
    await expect(
      page.getByRole("heading", { name: "Cloud is not configured on this deployment" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/Managed Cloud isn't fully configured on this deployment/),
    ).toBeVisible();

    // The user must NEVER see the old user-auth CTA when the operator must
    // configure the deployment — the whole point of PR2-GATING-01.
    await expect(page.getByRole("heading", { name: "Authorize GitHub App" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Authorize GitHub App/ })).toHaveCount(0);
    // The operator gate is explanatory only: no primary action button.
    await expect(page.getByRole("button", { name: /Connect GitHub App/ })).toHaveCount(0);

    // Back returns to the entry step cleanly.
    await page.getByRole("button", { name: "Back" }).click();
    await expectEntryStepVisible(page);
  });
});

// NOT COVERED by this wave, named so the gap is loud rather than silent:
// - Worktree creation end to end (name/branch/base-ref resolution, the
//   actual runtime call) — not reachable from the Add-Repo flow at all (see
//   the SPEC DIVERGENCE note above), and requires a live local AnyHarness
//   runtime this suite's CI profile disables. Tier 3's desktop lane owns
//   this per the scenario's own fallback framing.
// - Local repo creation's success path (a real native folder picker
//   selection -> addRepoFromPath -> repo registered) — Tauri-only, no web
//   fallback exists for the OS file dialog itself, regardless of the
//   Tauri-only carve-out in scenarios.md (this is a different Tauri
//   surface with the same "no web equivalent" property).
// - The cloud branch's happy path past the readiness blocker (repo search,
//   validate, save) — this operator-incomplete deployment stops at the gate-1
//   operator-configuration blocker (no GITHUB_APP_* seeded), so the per-repo
//   authorize/install/pick path is unreachable here; a deployment that seeds
//   GitHub App runtime config (see capability-contract.spec.ts's hosted-mode
//   boot) owns that path.
// - The "Add an existing folder" option's native-folder-picker happy path —
//   Tauri-only, no web fallback exists for the OS file dialog. This suite's
//   Desktop-over-web client renders the option (verified above) but its picker
//   (pickFolder -> Tauri invoke) resolves to null in a plain browser, so the
//   happy path (folder selection -> addRepoFromPath -> repo registered) is
//   unreachable here; Tier 3's real desktop lane owns it. What IS asserted is
//   the safe no-op: opening the entry step registers nothing and raises no
//   error toast (see the second test). The genuine Web bundle omits the option
//   entirely (host.desktop === null); that cloud-only contract is pinned by
//   unit tests (AddRepoFlow.test.tsx, web-host.test.tsx), not this suite, which
//   does not boot apps/web.
