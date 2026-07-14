import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthOrchestrationDeps } from "@/lib/integrations/auth/orchestration-effects";
import type { ProductEntry } from "@proliferate/product-client/host/product-host";

const mocks = vi.hoisted(() => ({
  getProliferateApiBaseUrl: vi.fn(),
  setDesktopAppConfig: vi.fn(),
  relaunch: vi.fn(),
  copyText: vi.fn(),
  openExternal: vi.fn(),
  subscribeDeepLinkUrls: vi.fn(),
  subscribeDevDesktopHandoffs: vi.fn(),
  discoverDesktopSso: vi.fn(),
  handleDesktopCallbackUrl: vi.fn(),
  authGeneration: 0,
  beginDesktopAuthTransaction: vi.fn(),
  trackProductEvent: vi.fn(),
  captureTelemetryException: vi.fn(),
  setTelemetryUser: vi.fn(),
  clearTelemetryUser: vi.fn(),
  setTelemetryTag: vi.fn(),
  getSupportReportReleaseId: vi.fn(),
  getSupportReportTelemetryRefs: vi.fn(),
  isTauriRuntimeAvailable: vi.fn(() => true),
}));

vi.mock("@/lib/infra/proliferate-api", () => ({
  getProliferateApiBaseUrl: mocks.getProliferateApiBaseUrl,
}));
vi.mock("@/lib/access/tauri/config", () => ({
  setDesktopAppConfig: mocks.setDesktopAppConfig,
}));
vi.mock("@/lib/access/tauri/connect-server", () => ({
  isTauriRuntimeAvailable: mocks.isTauriRuntimeAvailable,
}));
vi.mock("@/lib/access/tauri/updater", () => ({
  relaunch: mocks.relaunch,
}));
vi.mock("@/lib/access/tauri/shell", () => ({
  copyText: mocks.copyText,
  openExternal: mocks.openExternal,
}));
vi.mock("@/lib/access/tauri/deep-link", () => ({
  subscribeDeepLinkUrls: mocks.subscribeDeepLinkUrls,
}));
vi.mock("@/lib/integrations/navigation/dev-desktop-handoff-source", () => ({
  subscribeDevDesktopHandoffs: mocks.subscribeDevDesktopHandoffs,
}));
vi.mock("@/lib/integrations/auth/proliferate-sso-auth", () => ({
  discoverDesktopSso: mocks.discoverDesktopSso,
}));
vi.mock("@/lib/integrations/auth/orchestration-callback", () => ({
  beginDesktopAuthTransaction: mocks.beginDesktopAuthTransaction,
  handleDesktopCallbackUrl: mocks.handleDesktopCallbackUrl,
}));
vi.mock("@/lib/integrations/auth/desktop-auth-transaction", () => ({
  isCurrentDesktopAuthTransaction: (transaction: { generation: number }) =>
    transaction.generation === mocks.authGeneration,
  staleDesktopAuthTransactionError: () => {
    const error = new Error("Authentication attempt was replaced.");
    error.name = "AbortError";
    return error;
  },
}));
vi.mock("@/lib/integrations/auth/proliferate-auth", () => ({
  DESKTOP_AUTH_REDIRECT_URI: "proliferate://auth/callback",
}));
vi.mock("@/lib/integrations/telemetry/client", () => ({
  trackProductEvent: mocks.trackProductEvent,
  captureTelemetryException: mocks.captureTelemetryException,
  setTelemetryUser: mocks.setTelemetryUser,
  clearTelemetryUser: mocks.clearTelemetryUser,
  setTelemetryTag: mocks.setTelemetryTag,
  getSupportReportReleaseId: mocks.getSupportReportReleaseId,
  getSupportReportTelemetryRefs: mocks.getSupportReportTelemetryRefs,
}));

import {
  buildAnonymousMethods,
  createDesktopAuthOperations,
  createDesktopDeployment,
  desktopClipboard,
  desktopProductLinks,
  mapProductAuthUser,
} from "./desktop-product-host";

const SSO_UNAVAILABLE =
  "We could not find single sign-on for that workspace. Check the sign-in link your admin shared.";

function makeActions() {
  return {
    signInWithGitHub: vi.fn().mockResolvedValue(undefined),
    signInWithPassword: vi.fn().mockResolvedValue(undefined),
    signInWithSso: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    cancelAuthFlow: vi.fn().mockResolvedValue(undefined),
    linkGoogle: vi.fn().mockResolvedValue(undefined),
  };
}

const deps = {
  setAuthState: vi.fn(),
} as unknown as AuthOrchestrationDeps;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authGeneration = 0;
  mocks.beginDesktopAuthTransaction.mockImplementation(() => ({
    generation: ++mocks.authGeneration,
  }));
  mocks.isTauriRuntimeAvailable.mockReturnValue(true);
  mocks.getProliferateApiBaseUrl.mockReturnValue("https://api.example.test");
  mocks.subscribeDevDesktopHandoffs.mockReturnValue(vi.fn());
});

describe("createDesktopDeployment", () => {
  it("reads apiBaseUrl from the runtime config at construction", () => {
    mocks.getProliferateApiBaseUrl.mockReturnValue("https://api.example.test");
    const deployment = createDesktopDeployment();
    expect(deployment.apiBaseUrl).toBe("https://api.example.test");
  });

  it("omits native deployment actions outside the Tauri runtime", () => {
    mocks.getProliferateApiBaseUrl.mockReturnValue("https://api.example.test");
    mocks.isTauriRuntimeAvailable.mockReturnValue(false);

    const deployment = createDesktopDeployment();

    expect(deployment).toEqual({ apiBaseUrl: "https://api.example.test" });
  });

  it("switchDeployment writes config before relaunch", async () => {
    const order: string[] = [];
    mocks.setDesktopAppConfig.mockImplementation(async () => {
      order.push("config");
    });
    mocks.relaunch.mockImplementation(async () => {
      order.push("relaunch");
    });
    const deployment = createDesktopDeployment();

    await deployment.switchDeployment!("https://self-hosted.example.test");

    expect(mocks.setDesktopAppConfig).toHaveBeenCalledWith({
      apiBaseUrl: "https://self-hosted.example.test",
    });
    expect(order).toEqual(["config", "relaunch"]);
  });

  it("resetDeployment writes a null config before relaunch", async () => {
    const order: string[] = [];
    mocks.setDesktopAppConfig.mockImplementation(async () => {
      order.push("config");
    });
    mocks.relaunch.mockImplementation(async () => {
      order.push("relaunch");
    });
    const deployment = createDesktopDeployment();

    await deployment.resetDeployment!();

    expect(mocks.setDesktopAppConfig).toHaveBeenCalledWith({ apiBaseUrl: null });
    expect(order).toEqual(["config", "relaunch"]);
  });

  it("a config-write failure rejects and does not relaunch", async () => {
    mocks.setDesktopAppConfig.mockRejectedValue(new Error("write failed"));
    const deployment = createDesktopDeployment();

    await expect(
      deployment.switchDeployment!("https://self-hosted.example.test"),
    ).rejects.toThrow("write failed");
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});

describe("mapProductAuthUser", () => {
  it("maps the Desktop user fields to the product identity", () => {
    expect(
      mapProductAuthUser({
        id: "user-1",
        email: "a@example.test",
        display_name: "Ada",
        avatar_url: "https://avatar.test/a.png",
        github_login: "ada",
      }),
    ).toEqual({
      id: "user-1",
      displayName: "Ada",
      email: "a@example.test",
      avatarUrl: "https://avatar.test/a.png",
      githubLogin: "ada",
    });
  });
});

describe("buildAnonymousMethods", () => {
  it("includes only available methods in a fixed order", () => {
    expect(
      buildAnonymousMethods({
        passwordAvailable: true,
        githubAvailable: true,
        ssoAvailable: true,
      }),
    ).toEqual(["password", "github", "sso"]);
  });

  it("omits unavailable methods and never lists google or apple", () => {
    expect(
      buildAnonymousMethods({
        passwordAvailable: false,
        githubAvailable: true,
        ssoAvailable: false,
      }),
    ).toEqual(["github"]);
    expect(
      buildAnonymousMethods({
        passwordAvailable: false,
        githubAvailable: false,
        ssoAvailable: false,
      }),
    ).toEqual([]);
  });
});

describe("createDesktopAuthOperations - startLogin disposition", () => {
  it("cancels a prior provider transaction before claiming a supported login", async () => {
    const order: string[] = [];
    const actions = makeActions();
    actions.cancelAuthFlow.mockImplementation(async () => {
      order.push("cancel");
    });
    actions.signInWithPassword.mockImplementation(async () => {
      order.push("password");
    });
    mocks.beginDesktopAuthTransaction.mockImplementation(() => {
      order.push("reset");
      return { generation: ++mocks.authGeneration };
    });
    const ops = createDesktopAuthOperations(actions, () => deps);

    await ops.startLogin({
      kind: "password",
      email: "a@example.test",
      password: "pw",
    });

    expect(actions.cancelAuthFlow).toHaveBeenCalledWith(
      "A new sign-in attempt replaced the previous one.",
    );
    expect(order).toEqual(["reset", "cancel", "password"]);
  });

  it("does not disturb the current transaction for an unsupported request", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);

    await expect(
      ops.startLogin({ kind: "github", purpose: "required_github_link" }),
    ).rejects.toThrow();

    expect(actions.cancelAuthFlow).not.toHaveBeenCalled();
    expect(mocks.beginDesktopAuthTransaction).not.toHaveBeenCalled();
    expect(deps.setAuthState).not.toHaveBeenCalled();
  });

  it("password delegates email/password to signInWithPassword", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await ops.startLogin({
      kind: "password",
      email: "a@example.test",
      password: "pw",
    });
    expect(actions.signInWithPassword).toHaveBeenCalledWith({
      email: "a@example.test",
      password: "pw",
    }, expect.any(Object));
  });

  it("github with omitted purpose delegates prompt to signInWithGitHub", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await ops.startLogin({ kind: "github" });
    expect(actions.signInWithGitHub).toHaveBeenCalledWith(
      { prompt: undefined },
      expect.any(Object),
    );
  });

  it("github with purpose login forwards the select_account prompt", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await ops.startLogin({
      kind: "github",
      purpose: "login",
      prompt: "select_account",
    });
    expect(actions.signInWithGitHub).toHaveBeenCalledWith({
      prompt: "select_account",
    }, expect.any(Object));
  });

  it("github link and required_github_link reject without delegating", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await expect(
      ops.startLogin({ kind: "github", purpose: "link" }),
    ).rejects.toThrow();
    await expect(
      ops.startLogin({ kind: "github", purpose: "required_github_link" }),
    ).rejects.toThrow();
    expect(actions.signInWithGitHub).not.toHaveBeenCalled();
  });

  it("google link delegates to linkGoogle", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await ops.startLogin({ kind: "google", purpose: "link" });
    expect(actions.linkGoogle).toHaveBeenCalledTimes(1);
  });

  it("google login, required_github_link, and omitted purpose reject", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await expect(
      ops.startLogin({ kind: "google", purpose: "login" }),
    ).rejects.toThrow();
    await expect(
      ops.startLogin({ kind: "google", purpose: "required_github_link" }),
    ).rejects.toThrow();
    await expect(ops.startLogin({ kind: "google" })).rejects.toThrow();
    expect(actions.linkGoogle).not.toHaveBeenCalled();
  });

  it("apple rejects for any purpose", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await expect(ops.startLogin({ kind: "apple" })).rejects.toThrow();
    await expect(
      ops.startLogin({ kind: "apple", purpose: "login" }),
    ).rejects.toThrow();
  });

  it("sso without slug forwards the supplied fields to signInWithSso", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await ops.startLogin({
      kind: "sso",
      email: "a@example.test",
      organizationId: "org-1",
      connectionId: "conn-1",
    });
    expect(actions.signInWithSso).toHaveBeenCalledWith({
      email: "a@example.test",
      organizationId: "org-1",
      connectionId: "conn-1",
    }, expect.any(Object));
    expect(mocks.discoverDesktopSso).not.toHaveBeenCalled();
  });

  it("sso with slug discovers then signs in with the resolved org/connection", async () => {
    mocks.discoverDesktopSso.mockResolvedValue({
      enabled: true,
      organizationId: "org-resolved",
      connectionId: "conn-resolved",
    });
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await ops.startLogin({
      kind: "sso",
      slug: "acme",
      email: "a@example.test",
      organizationId: "org-hint",
      connectionId: "conn-hint",
    });
    expect(mocks.discoverDesktopSso).toHaveBeenCalledWith({
      slug: "acme",
      email: "a@example.test",
      organizationId: "org-hint",
      connectionId: "conn-hint",
    });
    expect(actions.signInWithSso).toHaveBeenCalledWith({
      organizationId: "org-resolved",
      connectionId: "conn-resolved",
      prompt: "select_account",
    }, expect.any(Object));
  });

  it("sso with slug rejects with the generic message when discovery is disabled or unresolved", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);

    mocks.discoverDesktopSso.mockResolvedValueOnce({ enabled: false });
    await expect(
      ops.startLogin({ kind: "sso", slug: "acme" }),
    ).rejects.toThrow(SSO_UNAVAILABLE);

    mocks.discoverDesktopSso.mockResolvedValueOnce({
      enabled: true,
      organizationId: null,
    });
    await expect(
      ops.startLogin({ kind: "sso", slug: "acme" }),
    ).rejects.toThrow(SSO_UNAVAILABLE);

    expect(actions.signInWithSso).not.toHaveBeenCalled();
  });

  it("lets only the latest overlapping accepted start reach its auth action", async () => {
    let releaseFirstCancel!: () => void;
    let releaseSecondCancel!: () => void;
    const firstCancel = new Promise<void>((resolve) => {
      releaseFirstCancel = resolve;
    });
    const secondCancel = new Promise<void>((resolve) => {
      releaseSecondCancel = resolve;
    });
    const actions = makeActions();
    actions.cancelAuthFlow
      .mockReturnValueOnce(firstCancel)
      .mockReturnValueOnce(secondCancel);
    const ops = createDesktopAuthOperations(actions, () => deps);

    const first = ops.startLogin({
      kind: "password",
      email: "old@example.test",
      password: "old",
    });
    const second = ops.startLogin({
      kind: "password",
      email: "new@example.test",
      password: "new",
    });

    releaseSecondCancel();
    await expect(second).resolves.toBeUndefined();
    releaseFirstCancel();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });

    expect(actions.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(actions.signInWithPassword).toHaveBeenCalledWith(
      { email: "new@example.test", password: "new" },
      expect.objectContaining({ generation: 2 }),
    );
  });
});

describe("createDesktopAuthOperations - finishLogin", () => {
  it("passes a missing state to the host callback state machine as malformed input", async () => {
    mocks.handleDesktopCallbackUrl.mockResolvedValue(true);
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await ops.finishLogin({ status: "success", code: "abc" });
    expect(mocks.handleDesktopCallbackUrl).toHaveBeenCalledWith(
      "proliferate://auth/callback?code=abc",
      deps,
    );
  });

  it("reconstructs the callback URL and delegates to the existing handler", async () => {
    mocks.handleDesktopCallbackUrl.mockResolvedValue(true);
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await ops.finishLogin({ status: "success", code: "abc", state: "xyz" });
    expect(mocks.handleDesktopCallbackUrl).toHaveBeenCalledWith(
      "proliferate://auth/callback?code=abc&state=xyz",
      deps,
    );
  });

  it("normalizes provider failure as an error callback", async () => {
    mocks.handleDesktopCallbackUrl.mockResolvedValue(true);
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await ops.finishLogin({
      status: "failure",
      code: "access_denied",
      state: "xyz",
    });
    expect(mocks.handleDesktopCallbackUrl).toHaveBeenCalledWith(
      "proliferate://auth/callback?error=access_denied&state=xyz",
      deps,
    );
  });

  it("rejects when the callback handler declines", async () => {
    mocks.handleDesktopCallbackUrl.mockResolvedValue(false);
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await expect(
      ops.finishLogin({ status: "success", code: "abc", state: "xyz" }),
    ).rejects.toThrow();
  });
});

describe("createDesktopAuthOperations - cancel/logout", () => {
  it("cancelLogin delegates to cancelAuthFlow", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await ops.cancelLogin();
    expect(actions.cancelAuthFlow).toHaveBeenCalledTimes(1);
  });

  it("logout delegates to signOut", async () => {
    const actions = makeActions();
    const ops = createDesktopAuthOperations(actions, () => deps);
    await ops.logout();
    expect(actions.signOut).toHaveBeenCalledTimes(1);
    expect(actions.signOut).toHaveBeenCalledWith({ generation: 1 });
  });
});

describe("clipboard and links adapters", () => {
  it("clipboard.writeText delegates once to copyText", async () => {
    await desktopClipboard.writeText("copied");
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    expect(mocks.copyText).toHaveBeenCalledWith("copied");
  });

  it("links.openExternal delegates once to openExternal", async () => {
    await desktopProductLinks.openExternal("https://example.test");
    expect(mocks.openExternal).toHaveBeenCalledTimes(1);
    expect(mocks.openExternal).toHaveBeenCalledWith("https://example.test");
  });

  it("links.buildReturnUrl encodes the entry as a Desktop deep link", () => {
    const entry: ProductEntry = { kind: "workspace", workspaceId: "ws1" };
    expect(desktopProductLinks.buildReturnUrl(entry)).toBe(
      "proliferate://workspaces/ws1",
    );
  });

  it("links.observeInboundEntries subscribes once and delivers only decoded entries", () => {
    let rawListener: ((url: string) => void) | null = null;
    const unsubscribeNative = vi.fn();
    const unsubscribeDev = vi.fn();
    mocks.subscribeDeepLinkUrls.mockImplementation((listener) => {
      rawListener = listener;
      return unsubscribeNative;
    });
    mocks.subscribeDevDesktopHandoffs.mockReturnValue(unsubscribeDev);
    const received: ProductEntry[] = [];
    const returned = desktopProductLinks.observeInboundEntries((entry) => {
      received.push(entry);
    });

    expect(mocks.subscribeDeepLinkUrls).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeDevDesktopHandoffs).toHaveBeenCalledWith(
      "https://api.example.test",
      expect.any(Function),
    );

    rawListener!("proliferate://workspaces/ws1");
    rawListener!("https://unknown.example.test/nope");

    expect(received).toEqual([
      { kind: "workspace", workspaceId: "ws1" },
    ]);
    returned();
    expect(unsubscribeNative).toHaveBeenCalledTimes(1);
    expect(unsubscribeDev).toHaveBeenCalledTimes(1);
  });
});
