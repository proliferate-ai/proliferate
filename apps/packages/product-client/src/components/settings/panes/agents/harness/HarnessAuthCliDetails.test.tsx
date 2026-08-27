// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliDetails } from "#product/components/settings/panes/agents/harness/HarnessAuthCliDetails";
import {
  harnessStatusFixture,
  verifiedHarnessStatus,
} from "#product/hooks/access/anyharness/agent-auth/use-harness-status.fixtures";
import type { HarnessStatus } from "#product/hooks/access/anyharness/agent-auth/use-harness-status";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";

/**
 * The CLI/native method detail area, in isolation (split out of
 * HarnessPane.test.tsx: the affordance now has its own input — the runtime's
 * status document — and the pane suite sits at its size ratchet).
 *
 * What every case here is really about: the affordance keys off the DOCUMENT.
 * The deleted derivation read `cliAuthState`, falling back to `readiness`, and
 * when either disagreed with the runtime the user lost the only way forward.
 */
const state = vi.hoisted(() => ({
  status: null as HarnessStatus | null,
}));

vi.mock("#product/hooks/access/anyharness/agent-auth/use-harness-status", () => ({
  useHarnessStatus: () => state.status ?? harnessStatusFixture(),
}));

const openAuthTerminal = vi.fn();

function editorFor(
  localAgent: Record<string, unknown> | null,
): HarnessAuthEditorApi {
  return {
    localAgent,
    loginSession: null,
    loginWorkflow: {
      openAuthTerminal,
      closeAuthTerminal: vi.fn(),
      handleTerminalExit: vi.fn(),
      runtimeConnection: {
        baseUrl: "http://runtime.test",
        authToken: "token",
        webSocketAuthTransport: undefined,
      },
    },
  } as unknown as HarnessAuthEditorApi;
}

const CLAUDE = {
  kind: "claude",
  displayName: "Claude Code",
  supportsLogin: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.status = null;
});

afterEach(cleanup);

describe("CliDetails", () => {
  it("offers Authenticate when the runtime holds no observation", () => {
    render(<CliDetails harnessKind="claude" editor={editorFor({ ...CLAUDE, readiness: "login_required" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Authenticate" }));

    expect(openAuthTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "claude" }),
      { restart: false },
    );
  });

  it("says nothing at all once the document is green", () => {
    // The state is said exactly once, in the header badge. A dated, verified
    // observation is the ONE thing that empties this area.
    state.status = verifiedHarnessStatus();

    const { container } = render(
      <CliDetails harnessKind="claude" editor={editorFor({ ...CLAUDE, readiness: "ready" })} />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button", { name: "Authenticate" })).toBeNull();
  });

  it("never nags a green NATIVE login with nothing applied (ruled 2026-08-27)", () => {
    // Native is a PERMANENT supported method: a harness launching on its own
    // detected login with a green probe is a healthy terminal. This area stays
    // empty for it — no Authenticate prompt, no push toward a managed method.
    // The mint offer lives in the pane's method cards as an optional upgrade.
    state.status = harnessStatusFixture({
      applied: null,
      probe: { verdict: "verified", at: "2026-08-27T00:00:00Z", stale: false },
    });

    const { container } = render(
      <CliDetails harnessKind="claude" editor={editorFor({ ...CLAUDE, readiness: "ready" })} />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button", { name: "Authenticate" })).toBeNull();
  });

  it.each([
    ["a failed observation", () => harnessStatusFixture({
      applied: { kind: "seat", seat_id: "seat-1" },
      probe: { verdict: "failed", at: "2026-08-27T00:00:00Z", stale: false },
    })],
    ["no document at all", () => harnessStatusFixture({ probe: null })],
    ["an unverified observation", () => harnessStatusFixture({
      applied: { kind: "seat", seat_id: "seat-1" },
      probe: { verdict: "unverified", at: null, stale: false },
    })],
    ["a verified verdict with NO evidence age", () => harnessStatusFixture({
      applied: { kind: "seat", seat_id: "seat-1" },
      probe: { verdict: "verified", at: null, stale: false },
    })],
  ])(
    "still offers Authenticate when a stale-authenticated keychain disagrees: %s",
    (_name, status) => {
      // The dead end this replaces: `cliAuthState: "authenticated"` (a stale
      // keychain read) with a failed or absent document rendered a destructive
      // "Not authenticated" badge AND returned null here — no Authenticate
      // button, no affordance at all. Both of those fields are unread now.
      state.status = status();

      render(
        <CliDetails
          harnessKind="claude"
          editor={editorFor({
            ...CLAUDE,
            cliAuthState: "authenticated",
            readiness: "ready",
          })}
        />,
      );

      expect(screen.getByRole("button", { name: "Authenticate" })).toBeTruthy();
    },
  );

  it("offers nothing for a harness that cannot log in, and never a dead end", () => {
    // supportsLogin is a CAPABILITY of the harness, not a state of its auth: the
    // one non-document input, and the only thing that withholds the button.
    render(
      <CliDetails
        harnessKind="grok"
        editor={editorFor({ kind: "grok", displayName: "Grok", supportsLogin: false })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Authenticate" })).toBeNull();
  });
});
