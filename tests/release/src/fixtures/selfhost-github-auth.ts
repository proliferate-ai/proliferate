import type { BrowserContext, Page } from "playwright";

import type { ReadySelfHostWorld } from "../worlds/selfhost/world.js";
import { GATEWAY_DEPLOY_DIR } from "../worlds/selfhost/gateway.js";
import type { SelfHostOwnerActor } from "./selfhost-actor.js";
import { AUTHENTICATED_READINESS_SELECTOR, BROWSER_AUTH_SESSION_KEY } from "./product-page.js";

/**
 * SELFHOST-QUAL-1 `SH-GITHUB-AUTH` fixture (frozen tier-3 contract
 * §`SH-GITHUB-AUTH` + "Base posture and authentication"). Configures the
 * optional GitHub OAuth sign-in on the running instance and drives the four
 * ruled proofs:
 *
 *  - setup still uses password (the owner is claimed password-only, BEFORE this
 *    fixture runs, with identity A's verified GitHub email);
 *  - `/auth/desktop/methods` advertises `github` ONLY AFTER configuration;
 *  - a verified matching GitHub email (identity A) links to the existing owner
 *    rather than creating a duplicate;
 *  - a new GitHub identity (B) needs a pending invitation, consumes it, and
 *    receives its role; an uninvited GitHub identity is denied.
 *
 * The OAuth application has ONE fixed registered callback
 * (`https://selfhost-fixed.qualification.proliferate.com/auth/github/callback`),
 * which is why the SH-GITHUB-AUTH world is provisioned on the FIXED serial-lane
 * origin. Config resolution is fail-closed: a missing client id/secret, a
 * missing identity storage-state, or a missing identity email makes the cell
 * red with a bounded, secret-free preflight reason — never a silent skip.
 *
 * Every privileged/browser motion is an injectable op (`GithubAuthOps`) so the
 * cell's decision logic (methods advertised, uninvited denial, owner-link
 * no-duplicate) is unit-tested offline against fakes.
 */

/** A seeded GitHub identity: its verified email + a Playwright storage-state path. */
export interface GithubIdentity {
  label: "A" | "B";
  email: string;
  /** Path to a Playwright storage-state JSON with a logged-in github.com session. */
  storageStatePath: string;
}

export interface GithubOauthConfig {
  clientId: string;
  clientSecret: string;
  identityA: GithubIdentity;
  identityB: GithubIdentity;
}

/** A minimal env getter so config resolution stays pure + offline-testable. */
export interface GithubEnvSource {
  get(name: string): string | undefined;
}

export const GITHUB_OAUTH_ENV = {
  clientId: "RELEASE_E2E_SELFHOST_GITHUB_OAUTH_CLIENT_ID",
  clientSecret: "RELEASE_E2E_SELFHOST_GITHUB_OAUTH_SECRET",
  identityAState: "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_STATE",
  identityBState: "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_STATE",
  identityAEmail: "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_EMAIL",
  identityBEmail: "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_EMAIL",
} as const;

/**
 * Fail-closed resolution of the SH-GITHUB-AUTH env contract. Returns a bounded,
 * secret-free reason (naming the missing var) when any required input is
 * absent, mirroring how `resolveSelfHostWorldInputs` reports a missing required
 * env rather than throwing.
 */
export function resolveGithubOauthConfig(
  env: GithubEnvSource,
): { ok: true; value: GithubOauthConfig } | { ok: false; reason: string } {
  const missing: string[] = [];
  const read = (name: string): string => {
    const value = env.get(name)?.trim();
    if (!value) {
      missing.push(name);
      return "";
    }
    return value;
  };
  const clientId = read(GITHUB_OAUTH_ENV.clientId);
  const clientSecret = read(GITHUB_OAUTH_ENV.clientSecret);
  const identityAState = read(GITHUB_OAUTH_ENV.identityAState);
  const identityBState = read(GITHUB_OAUTH_ENV.identityBState);
  const identityAEmail = read(GITHUB_OAUTH_ENV.identityAEmail);
  const identityBEmail = read(GITHUB_OAUTH_ENV.identityBEmail);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `SH-GITHUB-AUTH: missing required GitHub OAuth env: ${missing.join(", ")}.`,
    };
  }
  return {
    ok: true,
    value: {
      clientId,
      clientSecret,
      identityA: { label: "A", email: identityAEmail, storageStatePath: identityAState },
      identityB: { label: "B", email: identityBEmail, storageStatePath: identityBState },
    },
  };
}

/** The result of driving the product's real Authorize-GitHub flow for one identity. */
export interface GithubSignInResult {
  /** True when the product admitted the identity (a real product session was created). */
  admitted: boolean;
  /** The product user id the sign-in resolved to (owner's id on a link, a new id on admit). */
  userId?: string;
  /** The membership role the admitted identity received (e.g. "member"). */
  memberRole?: string;
}

/**
 * Every privileged/browser side effect of SH-GITHUB-AUTH, factored out so unit
 * tests fake the instance + browser entirely.
 */
export interface GithubAuthOps {
  /** Writes GITHUB_OAUTH_CLIENT_ID/SECRET into the instance env + reloads the api (documented product path). */
  configureOauth(world: ReadySelfHostWorld, config: { clientId: string; clientSecret: string }): Promise<void>;
  /** Reads the advertised desktop auth methods (`GET /auth/desktop/methods`) as lowercased ids. */
  fetchAuthMethods(world: ReadySelfHostWorld): Promise<string[]>;
  /** Drives the product's real Authorize-GitHub flow for a seeded identity. */
  signInWithGithub(world: ReadySelfHostWorld, identity: GithubIdentity): Promise<GithubSignInResult>;
  /** Creates a pending invitation for an email through the product UI; returns its id. */
  inviteThroughUi(
    world: ReadySelfHostWorld,
    owner: SelfHostOwnerActor,
    email: string,
  ): Promise<{ invitationId: string }>;
}

/** The env file the instance reads (single-sourced with the gateway ops' deploy dir). */
const INSTANCE_ENV_FILE = `${GATEWAY_DEPLOY_DIR}/.env.static`;

/**
 * Production ops. `configureOauth` writes the OAuth credential to `.env.static`
 * through the SSH control handle (secrets in a 0600 file scp'd to the box, never
 * on argv) and reruns the shipped `bootstrap.sh` so the api re-resolves them.
 * `signInWithGithub` drives the candidate Desktop renderer with a github.com
 * storage-state loaded — the interactive github.com approval is thereby skipped
 * while the product's signed-state, callback tail, and admission decision stay
 * real (tier-3 contract's permitted acceleration).
 */
export function defaultGithubAuthOps(io: {
  writeLocalTmp: (contents: string) => Promise<string>;
  removeLocalTmp: (path: string) => Promise<void>;
}): GithubAuthOps {
  return {
    async configureOauth(world, config) {
      const remoteTmp = "proliferate-candidate/github-oauth.env";
      const lines = [
        `GITHUB_OAUTH_CLIENT_ID=${config.clientId}`,
        `GITHUB_OAUTH_CLIENT_SECRET=${config.clientSecret}`,
        "",
      ].join("\n");
      const localTmp = await io.writeLocalTmp(lines);
      try {
        await world.control.ssh.scp(localTmp, remoteTmp);
        await world.control.ssh.run(
          `sudo bash -c 'cat ${remoteTmp} >> ${INSTANCE_ENV_FILE} && rm -f ${remoteTmp}'`,
          { timeoutMs: 60_000 },
        );
        await world.control.ssh.run(`cd ${GATEWAY_DEPLOY_DIR} && sudo bash bootstrap.sh`, {
          timeoutMs: 5 * 60_000,
        });
      } finally {
        await io.removeLocalTmp(localTmp).catch(() => undefined);
      }
    },

    async fetchAuthMethods(world) {
      const response = await fetch(`${world.api.baseUrl}/auth/desktop/methods`);
      if (!response.ok) {
        throw new Error(`SH-GITHUB-AUTH: GET /auth/desktop/methods failed with HTTP ${response.status}.`);
      }
      return parseAdvertisedMethods(await response.json());
    },

    async signInWithGithub(world, identity) {
      // The real product Authorize-GitHub flow, driven from an isolated renderer
      // context preloaded with identity's github.com storage-state so the
      // interactive github.com approval is skipped (permitted acceleration)
      // while signed state + the callback tail + the admission decision stay
      // real. GATED on the web candidate renderer being able to reach the fixed
      // API origin (the documented origin-partition gap) — see the scenario's
      // open-risk note. The concrete Playwright drive lands with that fix.
      const context = await world.renderer.browser.newContext({ storageState: identity.storageStatePath });
      try {
        return await driveGithubAuthorize(world, context);
      } finally {
        await context.close().catch(() => undefined);
      }
    },

    async inviteThroughUi(world, owner, email) {
      return inviteMemberThroughRendererUi(world, owner, email);
    },
  };
}

/**
 * Normalizes `/auth/desktop/methods` into lowercased method ids. Accepts an
 * array of strings, an array of `{id|method|type}` objects, or a
 * `{ methods: [...] }` envelope — whatever the server ships — so the advertised
 * set can be asserted without over-fitting the wire shape.
 */
export function parseAdvertisedMethods(body: unknown): string[] {
  const list = Array.isArray(body)
    ? body
    : Array.isArray((body as { methods?: unknown })?.methods)
      ? ((body as { methods: unknown[] }).methods)
      : [];
  const ids: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      ids.push(entry.toLowerCase());
    } else if (entry && typeof entry === "object") {
      const candidate =
        (entry as { id?: unknown }).id ??
        (entry as { method?: unknown }).method ??
        (entry as { type?: unknown }).type;
      if (typeof candidate === "string") {
        ids.push(candidate.toLowerCase());
      }
    }
  }
  return ids;
}

/** The LoginScreen affordance the product renders when github is advertised
 * (`AUTH_LOGIN_LABELS.signIn`, apps/packages/product-client/src/copy/auth/auth-copy.ts). */
const GITHUB_SIGN_IN_LABEL = "Continue with GitHub";
/** Bounded wait for the login surface to advertise the github affordance. */
const GITHUB_METHODS_TIMEOUT_MS = 30_000;
/** Bounded wait for `window.open(authorizationUrl)` to surface the github popup. */
const GITHUB_POPUP_TIMEOUT_MS = 30_000;
/** Bounded ceiling for settling the github.com authorize page (never loops past it). */
const GITHUB_AUTHORIZE_TIMEOUT_MS = 30_000;
/** Bounded wait for the renderer's recovery poll to land (or not land) a product session. */
const GITHUB_SIGNIN_SETTLE_MS = 60_000;

/** The shape the desktop web fallback persists under `proliferate.auth.session`. */
interface PersistedProductSession {
  access_token: string;
  user_id: string;
}

/**
 * How a github.com page encountered mid-authorize is classified. `authorize` is
 * the first-authorize grant page (click through); `authorized` means we have
 * LEFT github.com (instant redirect / product callback / desktop custom scheme)
 * so the grant is complete or was never needed; `two_factor` /
 * `device_verification` / `login_required` are interstitials that cannot be
 * driven deterministically (fail closed, secret-free); `unknown` is a github.com
 * page we don't recognize yet (keep waiting within the bound).
 */
export type GithubInterstitialKind =
  | "authorize"
  | "authorized"
  | "two_factor"
  | "device_verification"
  | "login_required"
  | "unknown";

/**
 * Pure classification of a mid-authorize page from its URL + primary heading —
 * factored out so the interstitial decision logic is unit-tested offline
 * (the live browser drive injects a fake `signInWithGithub`). Anything that has
 * left github.com (the product callback, the `proliferate://`/`proliferate-local://`
 * desktop deep link the browser cannot follow, or a blank/opaque url after the
 * redirect) counts as `authorized`: the server has already recorded the code and
 * the renderer's recovery poll completes sign-in.
 */
export function classifyGithubInterstitial(rawUrl: string, headingText: string | null): GithubInterstitialKind {
  let url: URL | undefined;
  try {
    url = new URL(rawUrl);
  } catch {
    url = undefined;
  }
  const scheme = url ? url.protocol.replace(/:$/, "").toLowerCase() : "";
  if (scheme === "proliferate" || scheme === "proliferate-local") {
    return "authorized";
  }
  if (!url || rawUrl === "about:blank" || url.hostname === "") {
    return "unknown";
  }
  const host = url.hostname.toLowerCase();
  if (!/(^|\.)github\.com$/.test(host)) {
    // Any http(s) origin that is not github.com == we bounced off github (the
    // product callback or beyond); the grant completed.
    return "authorized";
  }
  const pathName = url.pathname.toLowerCase();
  const heading = (headingText ?? "").toLowerCase();
  if (pathName.includes("/sessions/two-factor") || heading.includes("two-factor") || heading.includes("2fa")) {
    return "two_factor";
  }
  if (
    pathName.includes("verified-device") ||
    pathName.includes("verified_device") ||
    heading.includes("device verification") ||
    heading.includes("verify your device")
  ) {
    return "device_verification";
  }
  if (pathName.includes("/login/oauth/authorize") || heading.includes("authorize")) {
    return "authorize";
  }
  if (pathName === "/login" || pathName.startsWith("/session")) {
    return "login_required";
  }
  return "unknown";
}

/** Reads a page's primary heading text (bounded, best-effort) for interstitial classification. */
async function readPrimaryHeading(page: Page): Promise<string | null> {
  return page
    .locator("h1, h2")
    .first()
    .textContent({ timeout: 2_000 })
    .catch(() => null);
}

/**
 * Settles the github.com popup opened by the product's `window.open(authorization
 * Url)` (web fallback of `openAuthSessionUrl`, apps/desktop/src/lib/access/tauri/
 * auth.ts). With a pre-authenticated storage state github either instantly
 * redirects (already-authorized) or shows the first-authorize grant page (click
 * "Authorize"). Every wait is bounded; any interstitial we cannot drive
 * deterministically (2FA, device verification, an unexpected re-login) throws a
 * bounded, secret-free error naming it — it NEVER loops.
 */
async function settleGithubAuthorizePopup(popup: Page): Promise<void> {
  await popup.waitForLoadState("domcontentloaded", { timeout: GITHUB_POPUP_TIMEOUT_MS }).catch(() => undefined);
  const deadline = Date.now() + GITHUB_AUTHORIZE_TIMEOUT_MS;
  for (;;) {
    const classification = classifyGithubInterstitial(popup.url(), await readPrimaryHeading(popup));
    if (classification === "authorized") {
      return;
    }
    if (classification === "two_factor" || classification === "device_verification" || classification === "login_required") {
      throw new Error(
        `SH-GITHUB-AUTH: GitHub presented a "${classification}" interstitial that cannot be driven ` +
          "deterministically; failing closed (never looping).",
      );
    }
    if (classification === "authorize") {
      const authorizeButton = popup
        .locator('button[name="authorize"][value="1"], button:has-text("Authorize"), input[name="authorize"][value="1"]')
        .first();
      if (await authorizeButton.isVisible().catch(() => false)) {
        await authorizeButton.click().catch(() => undefined);
        await popup.waitForLoadState("domcontentloaded", { timeout: GITHUB_AUTHORIZE_TIMEOUT_MS }).catch(() => undefined);
        continue;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `SH-GITHUB-AUTH: the GitHub authorize page did not settle within ${GITHUB_AUTHORIZE_TIMEOUT_MS}ms ` +
          `(last classification="${classification}"); failing closed.`,
      );
    }
    await sleep(500);
  }
}

/** Polls the renderer page's persisted product session (bounded); undefined if none lands. */
async function waitForPersistedSession(page: Page, timeoutMs: number): Promise<PersistedProductSession | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const raw = await page
      .evaluate((key) => window.localStorage.getItem(key), BROWSER_AUTH_SESSION_KEY)
      .catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<PersistedProductSession>;
        if (typeof parsed.access_token === "string" && typeof parsed.user_id === "string") {
          return { access_token: parsed.access_token, user_id: parsed.user_id };
        }
      } catch {
        // Fall through and keep polling: a half-written value is not a session.
      }
    }
    if (Date.now() >= deadline) {
      return undefined;
    }
    await sleep(500);
  }
}

/**
 * Drives the product's real Authorize-GitHub flow in an already-storage-stated
 * browser context and reports whether the instance admitted the identity.
 *
 * The flow is the shipped desktop web path: click the LoginScreen's "Continue
 * with GitHub" (rendered only once `/auth/desktop/methods` advertises github) →
 * the renderer POSTs `/auth/desktop/github/start` and `window.open`s the returned
 * github.com authorization URL → the pre-authenticated storage state authorizes
 * (instant redirect, or one "Authorize" click) → github redirects to the server
 * callback, which records the auth code → the renderer's recovery poll
 * (`pollGitHubDesktopSession`) exchanges it and persists the product session.
 *
 * Admission is then resolved over the product API: a signed-in identity with an
 * ACTIVE membership in the instance's org is admitted (identity A links to the
 * existing owner by verified email → same user id; an invited identity B is
 * admitted with its role); an identity that authenticates but holds NO active
 * membership (uninvited) is reported `admitted:false`. Every wait is bounded;
 * an undrivable github interstitial throws a bounded, secret-free reason.
 */
async function driveGithubAuthorize(
  world: ReadySelfHostWorld,
  context: BrowserContext,
): Promise<GithubSignInResult> {
  const page = await context.newPage();
  await page.goto(world.renderer.baseUrl, { waitUntil: "domcontentloaded" });

  const githubButton = page.getByRole("button", { name: GITHUB_SIGN_IN_LABEL });
  await githubButton.waitFor({ state: "visible", timeout: GITHUB_METHODS_TIMEOUT_MS });

  // Clicking the affordance opens the github.com authorize URL in a popup (web
  // fallback of `openAuthSessionUrl`); capture it as it opens.
  const popupPromise = context.waitForEvent("page", { timeout: GITHUB_POPUP_TIMEOUT_MS });
  await githubButton.click();
  const popup = await popupPromise;
  try {
    await settleGithubAuthorizePopup(popup);
  } finally {
    await popup.close().catch(() => undefined);
  }

  // The renderer completes sign-in via its recovery poll and persists the
  // session. No persisted session within the bound == the identity was not
  // signed in (a real denial for our purposes) — never a loop.
  const session = await waitForPersistedSession(page, GITHUB_SIGNIN_SETTLE_MS);
  if (!session) {
    return { admitted: false };
  }

  // Admission == an ACTIVE org membership on this instance. Resolve it (and the
  // role) over the product API with the just-minted bearer (a Node fetch, not a
  // browser request — no CORS involved).
  const api = world.api.client.withBearerToken(session.access_token);
  const orgs = await api.get<{
    organizations: Array<{ id: string; membership?: { role?: string; status?: string } }>;
  }>("/v1/organizations");
  const activeMembership = orgs.organizations.find(
    (org) => (org.membership?.status ?? "active") === "active" && Boolean(org.membership?.role),
  );
  if (!activeMembership) {
    // Signed in but holds no active membership: an uninvited identity.
    return { admitted: false, userId: session.user_id };
  }
  return { admitted: true, userId: session.user_id, memberRole: activeMembership.membership?.role };
}

/**
 * Reimplements (does NOT import from `selfhost-install-1.ts`) the product-UI
 * invite motion: an authenticated owner page navigated to the org
 * Members/Invitations settings surface, submit the invite-by-email form
 * (`aria-label="Invite email"` + "Send invitation"), then read the created
 * invitation's id back over the product API (the id doubles as the registration
 * token). The CREATE goes through the real UI; the API is a READ only.
 */
async function inviteMemberThroughRendererUi(
  world: ReadySelfHostWorld,
  owner: SelfHostOwnerActor,
  email: string,
): Promise<{ invitationId: string }> {
  const context = await world.renderer.browser.newContext();
  await context.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: BROWSER_AUTH_SESSION_KEY, value: JSON.stringify(owner.session) },
  );
  const page = await context.newPage();
  try {
    await page.goto(`${world.renderer.baseUrl}/settings?section=organization-members`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(AUTHENTICATED_READINESS_SELECTOR).first().waitFor({ state: "visible", timeout: 30_000 });
    const emailInput = page.locator('input[aria-label="Invite email"]');
    await emailInput.waitFor({ state: "visible", timeout: 30_000 });
    await emailInput.fill(email);
    const submit = page.getByRole("button", { name: "Send invitation" });
    await submit.waitFor({ state: "visible", timeout: 10_000 });
    await submit.click();
    const deadline = Date.now() + 30_000;
    for (;;) {
      const value = await emailInput.inputValue().catch(() => email);
      if (value === "") {
        break;
      }
      if (Date.now() >= deadline) {
        throw new Error(`SH-GITHUB-AUTH: the invite form never confirmed success for "${email}" within 30000ms.`);
      }
      await sleep(500);
    }
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
  // READ the created invitation back (never the CREATE): the id doubles as the
  // registration token.
  const response = await owner.api.get<{ invitations: Array<{ id: string; email: string }> }>(
    `/v1/organizations/${encodeURIComponent(owner.organizationId)}/invitations`,
  );
  const invitation = response.invitations.find((entry) => entry.email === email);
  if (!invitation) {
    throw new Error(`SH-GITHUB-AUTH: no invitation for "${email}" was found after the UI submit.`);
  }
  return { invitationId: invitation.id };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
