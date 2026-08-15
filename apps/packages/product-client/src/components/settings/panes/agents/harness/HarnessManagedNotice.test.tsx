// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import type { AgentSummary } from "@anyharness/sdk";
import { afterEach, expect, it } from "vitest";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost } from "#product/test/product-host-fixtures";
import { HarnessManagedNotice } from "#product/components/settings/panes/agents/harness/HarnessManagedNotice";

afterEach(cleanup);

function bothCopiesAgent(): AgentSummary {
  return {
    kind: "codex",
    displayName: "Codex",
    installState: "installed",
    readiness: "ready",
    agentProcess: { role: "agent_process", installed: true, source: "managed" },
    userPathCopyDetected: true,
  } as AgentSummary;
}

/** In-memory ProductStorage, so a dismissal written by one render is read back
 * by the next — the same object simulates persistence across "sessions". */
function makeMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      map.delete(key);
    },
  };
}

it("shows the notice when a managed copy lands alongside a user PATH copy", async () => {
  const host = makeTestProductHost({ storage: makeMemoryStorage() });
  render(
    <ProductHostProvider host={host}>
      <HarnessManagedNotice harnessKind="codex" displayName="Codex" agent={bothCopiesAgent()} />
    </ProductHostProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Proliferate now maintains its own managed copy")).toBeTruthy();
  });
  expect(screen.getByText("Your own Codex install is untouched and never modified.")).toBeTruthy();
});

it("is absent when there is no user PATH copy", async () => {
  const host = makeTestProductHost({ storage: makeMemoryStorage() });
  const agent = { ...bothCopiesAgent(), userPathCopyDetected: false };
  render(
    <ProductHostProvider host={host}>
      <HarnessManagedNotice harnessKind="codex" displayName="Codex" agent={agent} />
    </ProductHostProvider>,
  );

  // Give the hydration read a tick to settle either way.
  await waitFor(() => {
    expect(screen.queryByText("Proliferate now maintains its own managed copy")).toBeNull();
  });
});

it("persists dismissal so the notice does not show again", async () => {
  const host = makeTestProductHost({ storage: makeMemoryStorage() });
  const agent = bothCopiesAgent();

  const first = render(
    <ProductHostProvider host={host}>
      <HarnessManagedNotice harnessKind="codex" displayName="Codex" agent={agent} />
    </ProductHostProvider>,
  );
  await waitFor(() => {
    expect(screen.getByText("Proliferate now maintains its own managed copy")).toBeTruthy();
  });
  fireEvent.click(screen.getByText("Got it"));
  await waitFor(() => {
    expect(screen.queryByText("Proliferate now maintains its own managed copy")).toBeNull();
  });
  first.unmount();

  // A fresh mount (standing in for reopening the pane) reads the same
  // persisted dismissal and never shows the notice again.
  render(
    <ProductHostProvider host={host}>
      <HarnessManagedNotice harnessKind="codex" displayName="Codex" agent={agent} />
    </ProductHostProvider>,
  );
  await waitFor(() => {
    expect(screen.queryByText("Proliferate now maintains its own managed copy")).toBeNull();
  });
});
