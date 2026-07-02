// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentApiKeysSection } from "./AgentApiKeysSection";

const keysState = vi.hoisted(() => ({
  data: undefined as
    | { keys: Array<Record<string, unknown>> }
    | undefined,
  isLoading: false,
  isError: false,
}));
const createMutate = vi.hoisted(() => vi.fn());
const revokeMutate = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentApiKeys: () => keysState,
  useCreateAgentApiKey: () => ({ mutate: createMutate, isPending: false }),
  useRevokeAgentApiKey: () => ({ mutate: revokeMutate, isPending: false }),
}));

function apiKey(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "key-1",
    provider: "anthropic",
    displayName: "Work key",
    redactedHint: "sk-...abcd",
    status: "active",
    lastValidatedAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  keysState.data = undefined;
  keysState.isLoading = false;
  keysState.isError = false;
});

describe("AgentApiKeysSection", () => {
  it("renders keys with provider badge and redacted hint", () => {
    keysState.data = { keys: [apiKey()] };
    render(<AgentApiKeysSection />);

    expect(screen.queryAllByText("Anthropic").length).toBeGreaterThan(0);
    expect(screen.queryByText("Work key")).not.toBeNull();
    expect(screen.queryByText("sk-...abcd")).not.toBeNull();
  });

  it("shows an empty state when there are no keys", () => {
    keysState.data = { keys: [] };
    render(<AgentApiKeysSection />);

    expect(screen.queryByText("No API keys yet")).not.toBeNull();
  });

  it("submits the add-key form and clears the inputs", () => {
    keysState.data = { keys: [] };
    render(<AgentApiKeysSection />);

    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "openai" },
    });
    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Team key" },
    });
    fireEvent.change(screen.getByLabelText("Secret"), {
      target: { value: "sk-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add key" }));

    expect(createMutate).toHaveBeenCalledWith(
      { provider: "openai", displayName: "Team key", secret: "sk-secret" },
      expect.anything(),
    );

    const options = createMutate.mock.calls[0][1] as {
      onSuccess: (created: { displayName: string }) => void;
    };
    act(() => {
      options.onSuccess({ displayName: "Team key" });
    });
    expect((screen.getByLabelText("Key name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Secret") as HTMLInputElement).value).toBe("");
  });

  it("does not submit while the name or secret is empty", () => {
    keysState.data = { keys: [] };
    render(<AgentApiKeysSection />);

    const submit = screen.getByRole("button", { name: "Add key" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("revokes a key after confirmation", () => {
    keysState.data = { keys: [apiKey()] };
    render(<AgentApiKeysSection />);

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke key" }));

    expect(revokeMutate).toHaveBeenCalledWith("key-1", expect.anything());
  });
});
