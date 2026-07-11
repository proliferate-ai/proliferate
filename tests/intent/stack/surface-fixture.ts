import {
  expect,
  test as base,
  type Page,
} from "@playwright/test";

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  apiBaseUrl,
  apiRequest,
  ensureInstanceClaimed,
  ensureProductReady,
  getOwnOrganization,
  passwordLogin,
} from "./seed.ts";
import {
  browserSurfaceLane,
  expectedClientId,
  surfaceBaseUrl,
  type BrowserSurfaceLane,
  type SurfaceIdentityObservation,
  type SurfacePrincipal,
} from "./surface-contract.ts";

interface SurfaceFixture {
  lane: BrowserSurfaceLane;
  baseUrl: string;
  signIn: (principal: SurfacePrincipal) => Promise<SurfaceIdentityObservation>;
}

export const test = base.extend<{ surface: SurfaceFixture }>({
  surface: async ({ page }, use, testInfo) => {
    const lane = browserSurfaceLane(testInfo.project.name);
    await use({
      lane,
      baseUrl: surfaceBaseUrl(lane),
      signIn: (principal) => signInSurface(page, lane, principal),
    });
  },
});

export { expect };

export async function prepareSurfacePrincipal(): Promise<SurfacePrincipal> {
  await ensureInstanceClaimed();
  const tokens = await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  const viewer = await apiRequest<{ id: string; email: string }>("/users/me", {
    token: tokens.access_token,
  });
  if (viewer.status !== 200) {
    throw new Error(`Could not resolve surface fixture user (${viewer.status})`);
  }
  await ensureProductReady(viewer.body.id, viewer.body.email);
  const organization = await getOwnOrganization(tokens.access_token);
  return {
    userId: viewer.body.id,
    email: viewer.body.email,
    organizationId: organization.id,
  };
}

export async function signInSurface(
  page: Page,
  lane: BrowserSurfaceLane,
  principal: SurfacePrincipal,
): Promise<SurfaceIdentityObservation> {
  if (lane === "desktop-web") {
    await page.goto(surfaceBaseUrl(lane));
    await page.getByLabel("Email").fill(principal.email);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    const organizationsResponse = waitForOrganizationsResponse(page);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator("#main-sidebar")).toBeAttached({ timeout: 30_000 });
    const email = await page.evaluate(() => {
      const raw = window.localStorage.getItem("proliferate.auth.session");
      return raw ? (JSON.parse(raw) as { email?: string }).email ?? null : null;
    });
    if (!email) {
      throw new Error("Desktop browser session did not contain the signed-in email");
    }
    return observationFromBrowserResponses(page, lane, email, await organizationsResponse);
  }

  await page.goto(`${surfaceBaseUrl(lane)}/auth`);
  const result = await page.evaluate(
    async ({ apiUrl, email, password }) => {
      const response = await fetch(`${apiUrl}/auth/web/password/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return {
        status: response.status,
      };
    },
    { apiUrl: apiBaseUrl(), email: principal.email, password: ADMIN_PASSWORD },
  );
  if (result.status !== 200) {
    throw new Error(`Hosted Web password session failed (${result.status})`);
  }
  const viewerResponse = waitForViewerResponse(page);
  const organizationsResponse = waitForOrganizationsResponse(page);
  await page.goto(surfaceBaseUrl(lane));
  await expect(page.locator('div[data-proliferate-client="web"]')).toBeVisible({ timeout: 30_000 });
  const viewer = await (await viewerResponse).json() as { user?: { email?: string } };
  if (!viewer.user?.email) {
    throw new Error("Hosted Web auth viewer response did not contain an email");
  }
  return observationFromBrowserResponses(
    page,
    lane,
    viewer.user.email,
    await organizationsResponse,
  );
}

function waitForViewerResponse(page: Page) {
  return page.waitForResponse(
    (response) => (
      new URL(response.url()).pathname.endsWith("/v1/auth/viewer")
      && response.status() === 200
    ),
    { timeout: 30_000 },
  );
}

function waitForOrganizationsResponse(page: Page) {
  return page.waitForResponse(
    (response) => (
      new URL(response.url()).pathname.endsWith("/v1/organizations")
      && response.status() === 200
    ),
    { timeout: 30_000 },
  );
}

async function observationFromBrowserResponses(
  page: Page,
  lane: BrowserSurfaceLane,
  principalEmail: string,
  organizationsResponse: Awaited<ReturnType<typeof waitForOrganizationsResponse>>,
): Promise<SurfaceIdentityObservation> {
  const organizations = await organizationsResponse.json() as {
    organizations?: Array<{ id?: string }>;
  };
  const organizationId = organizations.organizations?.[0]?.id;
  if (!organizationId) {
    throw new Error("Browser organizations response did not contain an organization id");
  }
  const clientId = await page.evaluate(() => document.documentElement.dataset.proliferateClient ?? null);
  if (clientId !== expectedClientId(lane)) {
    throw new Error(`Expected ${expectedClientId(lane)} client marker, received ${String(clientId)}`);
  }
  return {
    lane,
    clientId,
    principalEmail,
    organizationId,
    pathname: new URL(page.url()).pathname,
  };
}
