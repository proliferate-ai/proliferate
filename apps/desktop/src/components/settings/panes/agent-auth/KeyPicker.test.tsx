// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentApiKey } from "@proliferate/cloud-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyPicker } from "./KeyPicker";

const createKeyMutate = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCreateAgentApiKey: () => ({ mutate: createKeyMutate, isPending: false }),
}));

function key(overrides: Partial<AgentApiKey> = {}): AgentApiKey {
  return {
    id: "key-1",
    provider: "anthropic",
    displayName: "Work key",
    redactedHint: "sk-...abcd",
    status: "active",
    lastValidatedAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as AgentApiKey;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KeyPicker", () => {
  it("lists keys with name, provider, and redacted hint, and selects by id", () => {
    const onSelect = vi.fn();
    render(
      <KeyPicker
        keys={[key(), key({ id: "key-2", displayName: "Backup key", redactedHint: "sk-...wxyz" })]}
        selectedKeyId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    expect(screen.queryByText(/Anthropic · sk-\.\.\.abcd/)).not.toBeNull();

    fireEvent.click(screen.getByText("Backup key"));
    expect(onSelect).toHaveBeenCalledWith("key-2");
  });

  it("filters the pool by provider and hides revoked keys", () => {
    render(
      <KeyPicker
        keys={[
          key(),
          key({ id: "key-2", provider: "openai", displayName: "OpenAI key" }),
          key({ id: "key-3", displayName: "Old key", status: "revoked" }),
        ]}
        provider="anthropic"
        selectedKeyId={null}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    expect(screen.queryByText("Work key")).not.toBeNull();
    expect(screen.queryByText("OpenAI key")).toBeNull();
    expect(screen.queryByText("Old key")).toBeNull();
  });

  it("summarizes the selected key on the trigger without re-showing the secret", () => {
    render(
      <KeyPicker keys={[key()]} selectedKeyId="key-1" onSelect={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: /Work key \(sk-\.\.\.abcd\)/ }),
    ).not.toBeNull();
  });

  it("creates a new key inline and attaches it", () => {
    const onSelect = vi.fn();
    createKeyMutate.mockImplementation((input, callbacks) => {
      callbacks.onSuccess({ ...key({ id: "key-new" }), ...input });
    });
    render(
      <KeyPicker
        keys={[]}
        provider="anthropic"
        selectedKeyId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    fireEvent.click(screen.getByText("+ Add new key"));

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Fresh key" },
    });
    fireEvent.change(screen.getByLabelText("Secret"), {
      target: { value: "sk-ant-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    expect(createKeyMutate).toHaveBeenCalledWith(
      { provider: "anthropic", displayName: "Fresh key", secret: "sk-ant-secret" },
      expect.anything(),
    );
    expect(onSelect).toHaveBeenCalledWith("key-new");
    // The row-fixed provider means no provider select is shown inline.
    expect(screen.queryByLabelText("Provider")).toBeNull();
  });

  it("asks for a provider when the picker is not provider-scoped", () => {
    render(<KeyPicker keys={[]} selectedKeyId={null} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    fireEvent.click(screen.getByText("+ Add new key"));

    expect(screen.queryByLabelText("Provider")).not.toBeNull();
  });
});
