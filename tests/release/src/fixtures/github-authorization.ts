import { createInterface } from "node:readline";

import { ScenarioBlockedError } from "../scenarios/types.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";
import type { AuthenticatedActor } from "./authenticated-actor.js";

/**
 * The GitHub authorization controller (spec "Fixtures — GitHub authorization
 * controller"). It automates ONLY the human approval / code-exchange boundary
 * using the qualification actor; the PRODUCTION callback/completion tail (state
 * validation, token exchange, installation binding) stays under test — the
 * scenario drives the real product completion, this controller never reproduces
 * it. This is the cloud analogue of PR 1's `github-app-seed.ts`, but narrowed:
 * it plants nothing server-side; it only clears the browser-approval step so the
 * real callback runs.
 *
 * The real product flow it drives (verified against the candidate Server):
 *   - START: `GET {api_prefix}/v1/cloud/github-app/user-authorization/start`
 *     (authenticated as the actor) returns `{ authorizationUrl }` — a
 *     `https://github.com/login/oauth/authorize?...&state=<product-minted>`
 *     URL whose `state` the product signed and will validate on the callback
 *     (`server/proliferate/server/cloud/github_app/service.py`
 *     `create_github_app_user_authorization_url`).
 *   - HUMAN BOUNDARY: the actor approves in a browser; GitHub redirects to the
 *     product callback with `?code&state`.
 *   - TAIL (NOT us): the scenario feeds `code`+`state` to the product callback
 *     `/auth/github-app/user-authorization/callback`, which validates the state,
 *     exchanges the code, and binds the installation.
 *
 * Modes (spec: "Requires D2 (bot seed) for the fully-automated serial lane"):
 *   - `manual_assist` (local): a human completes the GitHub approval in a real
 *     browser; the controller pauses on a bounded operator-prompt seam and
 *     captures the redirect `code`+`state` (the operator pastes the callback
 *     URL), then hands them to the scenario for the production tail.
 *   - `automated` (needs D2): the qualification bot login drives approval
 *     headlessly. Unavailable until the D2 actor seed lands.
 *   - `blocked_honest` (Actions, until D2): the OAuth serial lane reports
 *     blocked honestly via `ScenarioBlockedError` — never skip-as-success.
 */

export type GithubAuthorizationMode = "manual_assist" | "automated" | "blocked_honest";

/**
 * The outcome of the human boundary only: the authorization code + state the
 * real callback needs. The controller stops here — the scenario runs the
 * product completion tail against these.
 */
export interface GithubAuthorizationBoundary {
  mode: GithubAuthorizationMode;
  /** The `code` GitHub returned on the redirect (short-lived; never persisted). */
  authorizationCode: string;
  /** The `state` the product minted at authorization start (echoed back for validation). */
  state: string;
}

export interface GithubAuthorizationOptions {
  /**
   * Forces a mode. Default resolves from the environment: `automated` when the
   * D2 bot seed is present, else `manual_assist` locally, else `blocked_honest`
   * in Actions.
   */
  mode?: GithubAuthorizationMode;
  /** Bounded wait for the redirect capture (default 300s for manual assist). */
  timeoutMs?: number;
}

/**
 * The seam the controller drives to clear ONLY the human boundary. The default
 * production wiring performs the real browser approval (manual assist) or the
 * bot login (automated); unit tests fake it so no real GitHub interaction
 * happens offline.
 */
export interface GithubAuthorizationTransport {
  /** Resolves the mode from D2-seed presence + origin (local vs Actions). */
  resolveMode(world: ManagedCloudWorld): GithubAuthorizationMode;
  /**
   * Starts the real product authorization (returns the GitHub authorize URL +
   * the product-minted state). No human step yet.
   */
  startAuthorization(
    world: ManagedCloudWorld,
    actor: AuthenticatedActor,
  ): Promise<{ authorizeUrl: string; state: string }>;
  /**
   * Completes ONLY the human approval boundary for the given authorize URL and
   * captures the redirect `code`. Manual-assist waits for a human; automated
   * uses the bot login. Never runs the product callback tail.
   */
  completeHumanBoundary(
    world: ManagedCloudWorld,
    params: { authorizeUrl: string; state: string; timeoutMs: number },
  ): Promise<{ authorizationCode: string }>;
}

/** Default manual-assist wait: a human needs time to approve in a real browser. */
export const DEFAULT_MANUAL_ASSIST_TIMEOUT_MS = 300_000;

/**
 * The D2 bot-seed handle (a founder item in flight). Its PRESENCE flips the
 * default mode to `automated`; while D2 is unlanded it is normally absent, so
 * the controller runs `manual_assist` locally and `blocked_honest` in Actions.
 * Names only — never a value in docs (extension contract).
 */
export const GITHUB_BOT_SEED_ENV = "RELEASE_E2E_CLOUD_GITHUB_BOT_SEED";

export const BLOCKED_HONEST_REASON =
  "CLOUD-PROVISION-1: the GitHub authorization boundary needs a human approval and no D2 bot seed " +
  `(${GITHUB_BOT_SEED_ENV}) is present, so the OAuth serial lane cannot run headlessly in Actions. Reporting ` +
  "blocked honestly (never skip-as-success); run locally in manual-assist mode, or land D2 for the automated lane.";

/**
 * Raised when the human boundary was NOT cleared with a usable authorization:
 * GitHub returned `error=access_denied` (the user declined), the redirect
 * carried no `code`, or the redirect `state` did not echo the started state.
 * Distinct from `ScenarioBlockedError` — this is a real denial of the flow, not
 * an out-of-band blocker.
 */
export class GithubAuthorizationDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubAuthorizationDeniedError";
  }
}

/**
 * Resolves the default mode from the environment (pure; env injected for tests).
 * `automated` when the D2 bot seed is present; otherwise `manual_assist` locally
 * and `blocked_honest` in GitHub Actions.
 */
export function resolveGithubAuthorizationMode(
  env: NodeJS.ProcessEnv = process.env,
): GithubAuthorizationMode {
  if (env[GITHUB_BOT_SEED_ENV]?.trim()) {
    return "automated";
  }
  if (env.GITHUB_ACTIONS === "true") {
    return "blocked_honest";
  }
  return "manual_assist";
}

/**
 * Extracts the product-minted `state` from a GitHub authorize URL so the
 * controller can hand it to the scenario's callback tail. Throws when the URL
 * is malformed or carries no `state` (the product always mints one).
 */
export function extractStateFromAuthorizeUrl(authorizeUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(authorizeUrl);
  } catch {
    throw new Error(`githubAuthorization: could not parse the authorize URL "${authorizeUrl}".`);
  }
  const state = parsed.searchParams.get("state");
  if (!state) {
    throw new Error(`githubAuthorization: the authorize URL carried no "state" query parameter (${authorizeUrl}).`);
  }
  return state;
}

/**
 * Parses the operator-supplied redirect into the authorization code, validating
 * it against the started `state`. Accepts either the full callback URL (the
 * operator pastes `.../callback?code=…&state=…`) or a bare `code`. A bare code
 * cannot be state-checked here (the product callback still validates state), so
 * it is accepted as-is. Throws `GithubAuthorizationDeniedError` on
 * `error=access_denied`, a missing code, or a state mismatch.
 */
export function parseRedirectCallback(
  input: string,
  expectedState: string,
): { authorizationCode: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new GithubAuthorizationDeniedError("githubAuthorization: empty redirect capture — no authorization code.");
  }

  // Bare code (no URL): accept; the product callback validates state.
  if (!trimmed.includes("?") && !/^https?:\/\//i.test(trimmed)) {
    return { authorizationCode: trimmed };
  }

  let parsed: URL;
  try {
    // Support both a full URL and a bare "?code=…&state=…" query fragment.
    parsed = trimmed.startsWith("?")
      ? new URL(`http://redirect.local/callback${trimmed}`)
      : new URL(trimmed);
  } catch {
    throw new GithubAuthorizationDeniedError(
      `githubAuthorization: could not parse the redirect capture as a URL or bare code.`,
    );
  }

  const error = parsed.searchParams.get("error");
  if (error) {
    const description = parsed.searchParams.get("error_description");
    throw new GithubAuthorizationDeniedError(
      `githubAuthorization: GitHub denied the authorization (error="${error}"${
        description ? `, description="${description}"` : ""
      }).`,
    );
  }

  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new GithubAuthorizationDeniedError(
      "githubAuthorization: the redirect carried no authorization code (the approval did not complete).",
    );
  }

  const redirectState = parsed.searchParams.get("state");
  if (redirectState !== null && redirectState !== expectedState) {
    // The controller does not own state validation (the product callback does),
    // but a redirect echoing a DIFFERENT state means the wrong flow was
    // captured — refuse it rather than hand a mismatched pair to the tail.
    throw new GithubAuthorizationDeniedError(
      "githubAuthorization: the redirect state did not match the started authorization state (wrong flow captured).",
    );
  }

  return { authorizationCode: code };
}

/**
 * Single-flight controller: concurrent or replayed `authorize()` calls converge
 * to exactly ONE authorization (one product-minted state, one captured code),
 * so a retried provisioning attempt can never mint two authorizations (which the
 * product could bind into two sandboxes — spec step 3's convergence). The
 * memoized promise is shared by every caller, including after it settles.
 */
export class GithubAuthorizationController {
  private inflight: Promise<GithubAuthorizationBoundary> | null = null;

  constructor(
    private readonly world: ManagedCloudWorld,
    private readonly actor: AuthenticatedActor,
    private readonly options: GithubAuthorizationOptions = {},
    private readonly transport: GithubAuthorizationTransport = defaultGithubAuthorizationTransport,
  ) {}

  /** Clears the human boundary once; concurrent/replayed calls share the result. */
  authorize(): Promise<GithubAuthorizationBoundary> {
    if (!this.inflight) {
      this.inflight = this.runAuthorization();
    }
    return this.inflight;
  }

  private async runAuthorization(): Promise<GithubAuthorizationBoundary> {
    const mode = this.options.mode ?? this.transport.resolveMode(this.world);
    if (mode === "blocked_honest") {
      throw new ScenarioBlockedError(BLOCKED_HONEST_REASON);
    }

    const { authorizeUrl, state } = await this.transport.startAuthorization(this.world, this.actor);
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_MANUAL_ASSIST_TIMEOUT_MS;
    const { authorizationCode } = await this.transport.completeHumanBoundary(this.world, {
      authorizeUrl,
      state,
      timeoutMs,
    });
    if (!authorizationCode) {
      throw new GithubAuthorizationDeniedError(
        "githubAuthorization: the human boundary returned no authorization code.",
      );
    }
    return { mode, authorizationCode, state };
  }
}

/**
 * Clears the human authorization boundary and returns the code+state for the
 * scenario's production completion tail. Throws `ScenarioBlockedError` in
 * `blocked_honest` mode (Actions without the D2 seed) so the OAuth serial lane
 * reports blocked honestly instead of skipping-as-success.
 */
export async function githubAuthorization(
  world: ManagedCloudWorld,
  actor: AuthenticatedActor,
  options: GithubAuthorizationOptions = {},
  transport: GithubAuthorizationTransport = defaultGithubAuthorizationTransport,
): Promise<GithubAuthorizationBoundary> {
  return new GithubAuthorizationController(world, actor, options, transport).authorize();
}

interface StartAuthorizationResponse {
  authorizationUrl?: string;
  authorization_url?: string;
}

export const defaultGithubAuthorizationTransport: GithubAuthorizationTransport = {
  resolveMode() {
    return resolveGithubAuthorizationMode();
  },
  async startAuthorization(_world, actor) {
    const response = await actor.api.get<StartAuthorizationResponse>(
      "/v1/cloud/github-app/user-authorization/start",
    );
    const authorizeUrl = response.authorizationUrl ?? response.authorization_url;
    if (!authorizeUrl) {
      throw new Error(
        "githubAuthorization: the product authorization-start response carried no authorizationUrl.",
      );
    }
    return { authorizeUrl, state: extractStateFromAuthorizeUrl(authorizeUrl) };
  },
  async completeHumanBoundary(_world, params) {
    if (process.env[GITHUB_BOT_SEED_ENV]?.trim()) {
      // resolveMode returns `automated` only when the seed is present; while D2
      // is unlanded this branch is dormant. Honest not-wired, not a fake pass.
      throw new Error(
        "githubAuthorization: automated (D2 bot-seed) approval is not wired in this fixture yet. Inject a " +
          "GithubAuthorizationTransport.completeHumanBoundary that drives the bot login once D2 lands.",
      );
    }
    const raw = await promptOperatorForRedirect(params.authorizeUrl, params.timeoutMs);
    return parseRedirectCallback(raw, params.state);
  },
};

/**
 * Bounded operator-prompt seam for manual-assist mode: prints the authorize URL
 * for the human to open, then reads the resulting redirect (full callback URL or
 * bare code) from stdin within the timeout. Never prints or persists the
 * captured code. Not exercised by unit tests (they fake the transport); the pure
 * `parseRedirectCallback` carries the logic this feeds.
 */
function promptOperatorForRedirect(authorizeUrl: string, timeoutMs: number): Promise<string> {
  // The authorize URL contains a client_id + signed state (no secret); safe to
  // print. The captured code is NEVER logged.
  process.stderr.write(
    "\n[CLOUD-PROVISION-1] Manual GitHub authorization required.\n" +
      `  1. Open this URL in a browser signed in as the qualification actor:\n     ${authorizeUrl}\n` +
      "  2. Approve, then paste the full redirect URL (…/callback?code=…&state=…) here and press Enter.\n",
  );
  return new Promise<string>((resolve, reject) => {
    const rl = createInterface({ input: process.stdin });
    const timer = setTimeout(() => {
      rl.close();
      reject(
        new GithubAuthorizationDeniedError(
          `githubAuthorization: no redirect pasted within ${timeoutMs}ms (manual-assist operator timed out).`,
        ),
      );
    }, timeoutMs);
    rl.once("line", (line) => {
      clearTimeout(timer);
      rl.close();
      resolve(line);
    });
  });
}
