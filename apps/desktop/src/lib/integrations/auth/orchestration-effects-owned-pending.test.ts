import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredPendingAuthSession } from "@/lib/access/tauri/auth";

const h = vi.hoisted(() => ({
  stored: null as StoredPendingAuthSession | null,
  clearStoredPendingAuthSession: vi.fn(async () => {}),
  getStoredPendingAuthSession: vi.fn(),
  setStoredPendingAuthSession: vi.fn(),
  cancelGitHubSignIn: vi.fn(),
}));

vi.mock("@/lib/access/tauri/auth", () => ({
  clearStoredAuthSession: vi.fn(),
  clearStoredPendingAuthSession: h.clearStoredPendingAuthSession,
  getStoredPendingAuthSession: h.getStoredPendingAuthSession,
  setStoredAuthSession: vi.fn(),
  setStoredPendingAuthSession: h.setStoredPendingAuthSession,
}));
vi.mock("@/lib/domain/auth/github-signin-state", () => ({
  cancelGitHubSignIn: h.cancelGitHubSignIn,
}));

import {
  registerDesktopAuthPendingState,
  replaceDesktopAuthTransaction,
} from "./desktop-auth-transaction";
import {
  clearPendingGitHubAuth,
  markPendingCallbackUrl,
} from "./orchestration-effects";

function pending(state: string): StoredPendingAuthSession {
  return {
    provider: "github",
    purpose: "login",
    state,
    code_verifier: `verifier-${state}`,
    redirect_uri: "proliferate://auth/callback",
    created_at: new Date().toISOString(),
    last_handled_callback_url: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.stored = null;
  h.getStoredPendingAuthSession.mockImplementation(async () => h.stored);
  h.setStoredPendingAuthSession.mockImplementation(async (record) => {
    h.stored = record;
  });
  h.clearStoredPendingAuthSession.mockImplementation(async () => {
    h.stored = null;
  });
});

describe("pending auth transaction ownership", () => {
  it("does not let a replaced owner mark or clear the replacement record", async () => {
    const oldTransaction = replaceDesktopAuthTransaction();
    expect(registerDesktopAuthPendingState(oldTransaction, "state-old")).toBe(true);

    const newTransaction = replaceDesktopAuthTransaction();
    expect(registerDesktopAuthPendingState(newTransaction, "state-new")).toBe(true);
    h.stored = pending("state-new");

    await expect(markPendingCallbackUrl(
      pending("state-old"),
      "proliferate://auth/callback?state=state-old&code=old",
      oldTransaction,
    )).resolves.toBe(false);
    await expect(clearPendingGitHubAuth(
      "state-old",
      new Error("old failed"),
      oldTransaction,
    )).resolves.toBe(false);

    expect(h.stored?.state).toBe("state-new");
    expect(h.setStoredPendingAuthSession).not.toHaveBeenCalled();
    expect(h.clearStoredPendingAuthSession).not.toHaveBeenCalled();
    expect(h.cancelGitHubSignIn).not.toHaveBeenCalled();

    await expect(markPendingCallbackUrl(
      h.stored,
      "proliferate://auth/callback?state=state-new&code=new",
      newTransaction,
    )).resolves.toBe(true);
    expect(h.stored?.last_handled_callback_url).toContain("state-new");
  });
});
