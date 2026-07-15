// @vitest-environment jsdom
import type { AuthUser, ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebSessionContextValue, WebSessionState } from "./browser/cloud/WebCloudRoot";

// Controllable session + viewer inputs. The host must rebuild its immutable
// snapshot whenever these authorities change while one provider stays mounted.
let sessionValue: WebSessionContextValue;
let viewerValue: { data?: { githubConnected: boolean } } = {};

vi.mock("./browser/cloud/WebCloudRoot", () => ({
  useWebSession: () => sessionValue,
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAuthViewer: () => viewerValue,
}));

import { useWebProductHost } from "./web-host";

const CLIENT_A = { baseUrl: "https://a" } as unknown as ProliferateCloudClient;
const USER: AuthUser = {
  id: "u1",
  email: "a@b.co",
  display_name: "Ada",
  github_login: "ada",
  avatar_url: null,
} as AuthUser;

function makeSession(state: WebSessionState, client = CLIENT_A): WebSessionContextValue {
  return {
    state,
    client,
    setSession: vi.fn(),
    publishIssue: vi.fn(),
    restoreSession: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
  };
}

afterEach(() => {
  cleanup();
  viewerValue = {};
  vi.clearAllMocks();
});

describe("useWebProductHost", () => {
  it("always supplies surface web and desktop null across every auth state", () => {
    for (const state of [
      { status: "loading", token: null, user: null, issue: null } as WebSessionState,
      {
        status: "authenticated",
        token: "tok",
        user: USER,
        issue: null,
      } as WebSessionState,
      {
        status: "anonymous",
        token: null,
        user: null,
        issue: { kind: "deployment_unreachable" } as ProductAuthIssue,
      } as WebSessionState,
    ]) {
      sessionValue = makeSession(state);
      const { result, unmount } = renderHook(() => useWebProductHost());
      expect(result.current.surface).toBe("web");
      expect(result.current.desktop).toBeNull();
      unmount();
    }
  });

  it("replaces the snapshot as the auth authority changes", () => {
    sessionValue = makeSession({
      status: "loading",
      token: null,
      user: null,
      issue: null,
    });
    const { result, rerender } = renderHook(() => useWebProductHost());
    const loadingHost = result.current;
    expect(loadingHost.auth.state).toEqual({ status: "loading" });

    sessionValue = makeSession({
      status: "authenticated",
      token: "tok",
      user: USER,
      issue: null,
    });
    rerender();
    const authedHost = result.current;
    expect(authedHost).not.toBe(loadingHost);
    expect(authedHost.auth.state).toMatchObject({
      status: "authenticated",
      readiness: { status: "ready" },
    });

    sessionValue = makeSession({
      status: "anonymous",
      token: null,
      user: null,
      issue: { kind: "access_denied", code: "web_beta_email_not_allowed" },
    });
    rerender();
    const anonHost = result.current;
    expect(anonHost).not.toBe(authedHost);
    expect(anonHost.auth.state).toMatchObject({
      status: "anonymous",
      issue: { kind: "access_denied", code: "web_beta_email_not_allowed" },
    });
  });

  it("maps a viewer with githubConnected false to the connect_github readiness", () => {
    sessionValue = makeSession({
      status: "authenticated",
      token: "tok",
      user: USER,
      issue: null,
    });
    viewerValue = { data: { githubConnected: false } };
    const { result } = renderHook(() => useWebProductHost());
    expect(result.current.auth.state).toMatchObject({
      status: "authenticated",
      readiness: { status: "action_required", action: "connect_github" },
    });
  });

  it("replaces the snapshot when the Cloud client authority changes", () => {
    const state: WebSessionState = {
      status: "authenticated",
      token: "tok",
      user: USER,
      issue: null,
    };
    sessionValue = makeSession(state, CLIENT_A);
    const { result, rerender } = renderHook(() => useWebProductHost());
    const first = result.current;

    const clientB = { baseUrl: "https://b" } as unknown as ProliferateCloudClient;
    sessionValue = makeSession(state, clientB);
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current.cloud.client).toBe(clientB);
  });
});
