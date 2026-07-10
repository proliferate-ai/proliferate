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
// AddRepoFlow.tsx's ENTRY_OPTIONS) has exactly two branches — "cloud" and
// "local" (split into copy-only variants "link-local"/"add-local") — there
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
// entry step renders all three options; picking either local option has no
// native folder picker outside Tauri (pickFolder / lib/access/tauri/shell.ts
// catches the invoke() failure and resolves null — this is the concrete
// "desktop-web limits apply" behavior named in the scenario title), so the
// dialog just stays put with nothing added, no crash; and picking the cloud
// option navigates to a real render branch that (for this suite's
// password-only account) surfaces the identical github_link_required
// product-readiness gate T2-WS-1/T2-SEC-1 already pin at the API layer, this
// time observed as the "Authorize GitHub App" blocker prompt in the UI.

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
async function ensureSidebarOpen(page: Page): Promise<void> {
  const showSidebarButton = page.getByRole("button", { name: "Show sidebar" });
  if (await showSidebarButton.isVisible().catch(() => false)) {
    await showSidebarButton.click();
  }
}

async function openAddRepoFlow(page: Page): Promise<void> {
  await ensureSidebarOpen(page);
  await page.getByRole("button", { name: "Add repository" }).click();
}

async function expectEntryStepVisible(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Add a repository" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Link a local repo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a cloud repo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a local repo" })).toBeVisible();
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
  test("Add-Repo entry step renders all three options", async ({ page }) => {
    await openAddRepoFlow(page);
    await expectEntryStepVisible(page);
  });

  for (const optionLabel of ["Link a local repo", "Add a local repo"] as const) {
    test(`desktop-web limit: picking "${optionLabel}" has no native folder picker, so it no-ops — dialog stays on the entry step, nothing added`, async ({ page }) => {
      await openAddRepoFlow(page);
      await expectEntryStepVisible(page);

      await page.getByRole("button", { name: optionLabel }).click();

      // pickFolder() (lib/access/tauri/shell.ts) calls Tauri's invoke()
      // outside a Tauri webview, which rejects; the catch resolves null, and
      // AddRepoFlowHost's handler returns immediately on a null path with no
      // state change at all — no step transition, no toast, no dialog close.
      // Give it a beat to prove that's steady state, not a race.
      await page.waitForTimeout(500);
      await expectEntryStepVisible(page);
      // No success/failure toast either: the no-op happens before
      // useAddRepo.addRepoFromPath is ever called.
      await expect(page.getByText(/Added |Add repository is unavailable/)).toHaveCount(0);
    });
  }

  test("cloud branch renders and reflects the account's GitHub product-readiness gate (same as T2-WS-1/T2-SEC-1)", async ({ page }) => {
    await openAddRepoFlow(page);
    await expectEntryStepVisible(page);

    await page.getByRole("button", { name: "Add a cloud repo" }).click();
    await expect(page.getByRole("heading", { name: "Add a cloud repo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();

    // useAddCloudEnvironment's GitHub App user-authorization query settles
    // (react-query retry: 1, apps/desktop's query-client.ts) to "not
    // connected" for this password-only account, same underlying
    // github_link_required gate T2-WS-1/T2-SEC-1 pin directly against the
    // API — here it's the CloudRepoPickerBlocker's rendered heading instead
    // of a raw 403.
    await expect(page.getByRole("heading", { name: "Authorize GitHub App" })).toBeVisible({ timeout: 30_000 });

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
//   lib/access/tauri/credentials.ts carve-out (this is a different Tauri
//   surface with the same "no web equivalent" property).
// - The cloud branch's happy path past the GitHub App blocker (repo search,
//   validate, save) — blocked by the same product-readiness gate
//   T2-WS-1/T2-SEC-1 already pin; PR #1023 (merged to main 2026-07-09) fixes
//   that gate at the source (current_product_user), so this should become
//   testable once tests/intent-wave2 rebases past it.
//
// Product finding filed while building this: the local-option no-op above
// has zero user feedback (no toast, no message) — a desktop-web user
// clicking "Add a local repo" sees nothing happen and no explanation that
// this needs the native app. Filed as
// https://github.com/proliferate-ai/proliferate/issues/1035; not fixing
// here, this PR is test-only.
