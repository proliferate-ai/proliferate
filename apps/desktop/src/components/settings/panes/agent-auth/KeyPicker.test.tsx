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
    title: "Work key",
    redactedHint: "sk-...abcd",
    status: "active",
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as AgentApiKey;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KeyPicker", () => {
  it("lists keys with title and redacted hint, and selects by id", () => {
    const onSelect = vi.fn();
    render(
      <KeyPicker
        keys={[key(), key({ id: "key-2", title: "Backup key", redactedHint: "sk-...wxyz" })]}
        selectedKeyId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    expect(screen.queryByText("sk-...abcd")).not.toBeNull();

    fireEvent.click(screen.getByText("Backup key"));
    expect(onSelect).toHaveBeenCalledWith("key-2");
  });

  it("hides revoked keys from the vault pool", () => {
    render(
      <KeyPicker
        keys={[
          key(),
          key({ id: "key-3", title: "Old key", status: "revoked" }),
        ]}
        selectedKeyId={null}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    expect(screen.queryByText("Work key")).not.toBeNull();
    expect(screen.queryByText("Old key")).toBeNull();
  });

  it("summarizes the selected key on the trigger without re-showing the secret", () => {
    render(<KeyPicker keys={[key()]} selectedKeyId="key-1" onSelect={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /Work key \(sk-\.\.\.abcd\)/ }),
    ).not.toBeNull();
  });

  it("creates a new key inline from title + value and attaches it", () => {
    const onSelect = vi.fn();
    createKeyMutate.mockImplementation((input, callbacks) => {
      callbacks.onSuccess({ ...key({ id: "key-new" }), ...input });
    });
    render(<KeyPicker keys={[]} selectedKeyId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    fireEvent.click(screen.getByText("New API key…"));

    fireEvent.change(screen.getByLabelText("Key title"), {
      target: { value: "Fresh key" },
    });
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "sk-ant-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    expect(createKeyMutate).toHaveBeenCalledWith(
      { title: "Fresh key", value: "sk-ant-secret" },
      expect.anything(),
    );
    expect(onSelect).toHaveBeenCalledWith("key-new");
  });
});
