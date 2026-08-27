import { describe, expect, it } from "vitest";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { deriveAuthStatus } from "#product/components/settings/panes/agents/harness/HarnessAuthStatusBadge";

// deriveAuthStatus is pure; each arm reads a narrow slice of the editor api.
// These build exactly the slice the seat and cli arms consume.
function editorWith(overrides: {
  seatEnabled?: boolean;
  cliAuthState?: string;
  authStateDisplay?: string;
}): HarnessAuthEditorApi {
  return {
    editorState: { seatEnabled: overrides.seatEnabled ?? true, rows: [] },
    localAgent: {
      kind: "claude",
      displayName: "Claude Code",
      readiness: "ready",
      supportsLogin: true,
      cliAuthState: overrides.cliAuthState,
      authState: overrides.authStateDisplay
        ? { display: overrides.authStateDisplay }
        : undefined,
    },
  } as unknown as HarnessAuthEditorApi;
}

// Founder ruling 2026-08-27, after the acceptance-gate false green (PR #2254):
// the seat method's badge may never borrow the CLI arm's native-login state.
// That arm scores bare file/keychain presence of the machine's OWN login — a
// different credential from the seat. Watched fail against the pre-ruling code
// at the pane level (HarnessPane rendered green "Authenticated" from
// cliAuthState with a seat selected); pinned here at the exact function the
// ruling changed, because the pane test file sits at its size ratchet.
describe("deriveAuthStatus seat arm (founder ruling 2026-08-27)", () => {
  it("never borrows the native login's green: present ~/.claude reads Unverified", () => {
    const status = deriveAuthStatus("seat", editorWith({ cliAuthState: "authenticated" }));
    expect(status.label).toBe("Unverified");
    expect(status.tone).toBe("warning");
  });

  it("a 401-rejected seat trial reads the red Expired state", () => {
    const status = deriveAuthStatus(
      "seat",
      editorWith({ cliAuthState: "authenticated", authStateDisplay: "expired" }),
    );
    expect(status.label).toBe("Expired");
    expect(status.tone).toBe("destructive");
  });

  it("greens only on the runtime's evidence-backed derivation", () => {
    for (const display of ["authenticated", "usable"]) {
      const status = deriveAuthStatus("seat", editorWith({ authStateDisplay: display }));
      expect(status.label).toBe("Authenticated");
      expect(status.tone).toBe("success");
    }
    // Acknowledged-but-unverified derived states stay amber.
    for (const display of ["selected", "installed"]) {
      const status = deriveAuthStatus("seat", editorWith({ authStateDisplay: display }));
      expect(status.label).toBe("Unverified");
    }
  });

  it("no enabled seat reads Not configured", () => {
    const status = deriveAuthStatus(
      "seat",
      editorWith({ seatEnabled: false, cliAuthState: "authenticated" }),
    );
    expect(status.label).toBe("Not configured");
    expect(status.tone).toBe("neutral");
  });

  it("the NATIVE method's own green is untouched (permanent method, ruled)", () => {
    const status = deriveAuthStatus("cli", editorWith({ cliAuthState: "authenticated" }));
    expect(status.label).toBe("Authenticated");
    expect(status.tone).toBe("success");
  });
});
