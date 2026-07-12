import { expect, test } from "@playwright/test";

import {
  prepareSurfacePrincipal,
  signInSurface,
} from "../../../stack/surface-fixture.ts";
import { apiBaseUrl } from "../../../stack/seed.ts";
import { surfaceBaseUrl } from "../../../stack/surface-contract.ts";

test("credentialed CORS admits both product origins and rejects an unlisted origin", async () => {
  for (const origin of [surfaceBaseUrl("desktop-web"), surfaceBaseUrl("hosted-web")]) {
    const response = await preflight(origin);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  }

  const rejected = await preflight("http://127.0.0.1:65530");
  expect(rejected.ok).toBe(false);
  expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
});

test("both products authenticate independently against the same principal and organization", async ({ browser }) => {
  const principal = await prepareSurfacePrincipal();
  const desktopContext = await browser.newContext();
  const hostedContext = await browser.newContext();
  try {
    const desktopPage = await desktopContext.newPage();
    const hostedPage = await hostedContext.newPage();
    const desktop = await signInSurface(desktopPage, "desktop-web", principal);
    const hosted = await signInSurface(hostedPage, "hosted-web", principal);

    expect(hosted.principalEmail).toBe(desktop.principalEmail);
    expect(hosted.organizationId).toBe(desktop.organizationId);

    const desktopSession = await desktopPage.evaluate(() => (
      window.localStorage.getItem("proliferate.auth.session")
    ));
    const hostedDesktopSession = await hostedPage.evaluate(() => (
      window.localStorage.getItem("proliferate.auth.session")
    ));
    expect(desktopSession).not.toBeNull();
    expect(hostedDesktopSession).toBeNull();

    const hostedCookies = await hostedContext.cookies();
    const refreshCookie = hostedCookies.find((cookie) => cookie.name === "proliferate_web_refresh");
    const csrfCookie = hostedCookies.find((cookie) => cookie.name === "proliferate_web_csrf");
    expect(refreshCookie).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
      path: "/auth/web/session",
    });
    expect(csrfCookie).toMatchObject({
      httpOnly: false,
      sameSite: "Lax",
      path: "/",
    });
    const documentCookie = await hostedPage.evaluate(() => document.cookie);
    expect(documentCookie).toContain("proliferate_web_csrf=");
    expect(documentCookie).not.toContain("proliferate_web_refresh=");
  } finally {
    await desktopContext.close();
    await hostedContext.close();
  }
});

function preflight(origin: string): Promise<Response> {
  return fetch(`${apiBaseUrl()}/meta`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
}
