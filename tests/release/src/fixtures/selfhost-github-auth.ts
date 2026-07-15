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

/**
 * Drives the product's Authorize-GitHub control in an already-storage-stated
 * browser context and reports whether the instance admitted the identity. This
 * is the concrete boundary the live proof lands at (origin-partition gap); the
 * offline tests never reach it (they inject a fake `signInWithGithub`).
 */
async function driveGithubAuthorize(
  world: ReadySelfHostWorld,
  context: import("playwright").BrowserContext,
): Promise<GithubSignInResult> {
  void world;
  void context;
  throw new Error(
    "SH-GITHUB-AUTH: the live GitHub-authorize drive is gated on the web renderer reaching the fixed API " +
      "origin (documented origin-partition gap); inject a fake signInWithGithub op for offline runs.",
  );
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
