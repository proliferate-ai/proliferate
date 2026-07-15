// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeysPane } from "./ApiKeysPane";
import { AGENT_API_KEYS_COPY } from "@/copy/settings/agent-api-keys-copy";

const state = vi.hoisted(() => ({
  cloudActive: true,
  keys: {
    data: [] as Array<Record<string, unknown>> | undefined,
    isLoading: false,
    isError: false,
  },
}));
const createMutate = vi.hoisted(() => vi.fn());
const revokeMutate = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentApiKeys: () => state.keys,
  useCreateAgentApiKey: () => ({ mutate: createMutate, isPending: false }),
  useRevokeAgentApiKey: () => ({ mutate: revokeMutate, isPending: false }),
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (s: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

// ConfirmationDialog wraps Radix Dialog (no jsdom polyfills) — stub to plain
// buttons so the revoke flow is exercisable.
vi.mock("@proliferate/ui/primitives/ConfirmationDialog", () => ({
  ConfirmationDialog: ({
    open,
    confirmLabel,
    onConfirm,
    onClose,
  }: {
    open: boolean;
    confirmLabel: string;
    onConfirm: () => void;
    onClose: () => void;
  }) =>
    open ? (
      <div>
        <button type="button" onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" onClick={onClose}>dialog-cancel</button>
      </div>
    ) : null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = true;
  state.keys.data = [];
  state.keys.isLoading = false;
  state.keys.isError = false;
});

function key(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    title: "Work key",
    redactedHint: "sk-...abcd",
    status: "active",
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("ApiKeysPane", () => {
  it("lists vault keys by title and redacted hint", () => {
    state.keys.data = [key(), key({ id: "key-2", title: "Backup", redactedHint: "sk-...wxyz" })];
    render(<ApiKeysPane />);

    expect(screen.queryByText("Work key")).not.toBeNull();
    expect(screen.queryByText("sk-...abcd")).not.toBeNull();
    expect(screen.queryByText("Backup")).not.toBeNull();
  });

  it("creates a key from title + value only", () => {
    render(<ApiKeysPane />);

    fireEvent.change(screen.getByLabelText(AGENT_API_KEYS_COPY.titleLabel), {
      target: { value: "Personal key" },
    });
    fireEvent.change(screen.getByLabelText(AGENT_API_KEYS_COPY.valueLabel), {
      target: { value: "sk-ant-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.addAction }));

    expect(createMutate).toHaveBeenCalledWith(
      { title: "Personal key", value: "sk-ant-123" },
      expect.anything(),
    );
  });

  it("revokes a key after confirmation", () => {
    revokeMutate.mockImplementation((_id, cbs) => cbs.onSuccess());
    state.keys.data = [key()];
    render(<ApiKeysPane />);

    fireEvent.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.revokeAction }));
    fireEvent.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.revokeConfirmLabel }));

    expect(revokeMutate).toHaveBeenCalledWith("key-1", expect.anything());
    expect(showToast).toHaveBeenCalledWith(AGENT_API_KEYS_COPY.revokedToast, "info");
  });

  it("lists the referencing harnesses on a 409 revoke conflict", () => {
    revokeMutate.mockImplementation((_id, cbs) =>
      cbs.onError(
        new ProliferateClientError(
          "This key is used by an enabled selection; disable those first.",
          409,
          "agent_api_key_referenced",
          { harnesses: ["claude", "opencode"] },
        ),
      ),
    );
    state.keys.data = [key()];
    render(<ApiKeysPane />);

    fireEvent.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.revokeAction }));
    fireEvent.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.revokeConfirmLabel }));

    expect(showToast).toHaveBeenCalledWith(
      AGENT_API_KEYS_COPY.revokeReferencedError(["claude", "opencode"]),
    );
  });
});
