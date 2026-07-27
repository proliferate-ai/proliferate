// TEMPORARY (workflows beta gate). While the workflows surface is unfinished,
// entering it raises a "This feature is in beta" notice over the real page. The
// notice is a dismissible interstitial, not a block: the surface is mounted and
// live behind it. But it is a real modal — the overlay intercepts pointer events
// and the dialog takes the accessibility tree — so specs that drive the
// workflows UI dismiss it first, exactly the way a user does.
//
// The acknowledgement is stored in sessionStorage, so one dismissal per browser
// context covers later reloads and navigations inside the same test.
//
// Delete this helper together with WORKFLOWS_BETA_GATE_ENABLED in
// apps/packages/product-client/src/pages/WorkflowsPage.tsx when workflows ship
// generally; every call site is a plain `await dismissWorkflowsBetaGate(page)`
// carrying the same note.

import { expect, type Page } from "@playwright/test";

const BETA_NOTICE_TITLE = "This feature is in beta";
const BETA_NOTICE_CONTINUE = "Continue anyway";

/**
 * Dismiss the beta notice if it is raised. Call immediately after navigating to
 * a `/workflows` route and before asserting on the surface behind it. A missing
 * notice is not a failure: the same browser context may already have
 * acknowledged it, or the gate may have been removed from the product.
 */
export async function dismissWorkflowsBetaGate(page: Page): Promise<void> {
  const notice = page.getByText(BETA_NOTICE_TITLE, { exact: true });
  try {
    await notice.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    return;
  }
  await page.getByRole("button", { name: BETA_NOTICE_CONTINUE, exact: true }).click();
  await expect(notice).toHaveCount(0);
}
