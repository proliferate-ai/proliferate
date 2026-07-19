// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeysPane } from "#product/components/settings/panes/agents/api-keys/ApiKeysPane";
import { AGENT_API_KEYS_COPY } from "#product/copy/settings/agent-api-keys-copy";

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
const refetchKeys = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentApiKeys: () => ({ ...state.keys, refetch: refetchKeys }),
  useCreateAgentApiKey: () => ({ mutate: createMutate, isPending: false }),
  useRevokeAgentApiKey: () => ({ mutate: revokeMutate, isPending: false }),
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("ApiKeysPane", () => {
  it("lists vault keys by title and redacted hint", () => {
    state.keys.data = [key(), key({ id: "key-2", title: "Backup", redactedHint: "sk-...wxyz" })];
    render(<ApiKeysPane />);

    expect(screen.queryByText("Work key")).not.toBeNull();
    expect(screen.queryByText("sk-...abcd")).not.toBeNull();
    expect(screen.queryByText("Backup")).not.toBeNull();
    expect(screen.queryByText("2 keys")).not.toBeNull();
  });

  it("labels the empty visual state without changing the existing form focus order", () => {
    const { container } = render(<ApiKeysPane />);

    expect(screen.queryByText(AGENT_API_KEYS_COPY.emptyTitle)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add first key" })).toBeNull();
    expect(container.querySelector('[data-api-keys-state="ready"]')).not.toBeNull();
  });

  it("exposes loading and error states for visual validation", () => {
    state.keys.isLoading = true;
    const loading = render(<ApiKeysPane />);
    expect(loading.container.querySelector('[data-api-keys-state="loading"]')).not.toBeNull();
    loading.unmount();

    state.keys.isLoading = false;
    state.keys.isError = true;
    const error = render(<ApiKeysPane />);
    expect(error.container.querySelector('[data-api-keys-state="error"]')).not.toBeNull();
  });

  it("retries a failed load once and transitions to the loaded key state", async () => {
    state.keys.isError = true;
    const retry = deferred<unknown>();
    refetchKeys.mockReturnValue(retry.promise);
    const user = userEvent.setup();
    const view = render(<ApiKeysPane />);

    const retryButton = screen.getByRole("button", { name: AGENT_API_KEYS_COPY.retryAction });
    const addButton = screen.getByRole("button", { name: AGENT_API_KEYS_COPY.addAction });
    expect(retryButton.getAttribute("type")).toBe("button");
    expect(addButton.getAttribute("type")).toBe("submit");
    expect(screen.queryByText(AGENT_API_KEYS_COPY.loadError)).not.toBeNull();

    await user.click(retryButton);
    await user.click(retryButton);

    expect(refetchKeys).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("button", {
        name: AGENT_API_KEYS_COPY.retryingAction,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.addAction })).toBe(addButton);

    state.keys.isError = false;
    state.keys.data = [key()];
    await act(async () => {
      retry.resolve({});
      await retry.promise;
    });
    view.rerender(<ApiKeysPane />);

    expect(screen.queryByText(AGENT_API_KEYS_COPY.loadError)).toBeNull();
    expect(screen.queryByRole("button", { name: AGENT_API_KEYS_COPY.retryAction })).toBeNull();
    expect(screen.queryByText("Work key")).not.toBeNull();
    expect(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.addAction })).toBe(addButton);
  });

  it("keeps failed Retry keyboard-accessible and restores it without duplicate refetch", async () => {
    state.keys.isError = true;
    const firstRetry = deferred<unknown>();
    const secondRetry = deferred<unknown>();
    refetchKeys
      .mockReturnValueOnce(firstRetry.promise)
      .mockReturnValueOnce(secondRetry.promise);
    const user = userEvent.setup();
    render(<ApiKeysPane />);

    const retryButton = screen.getByRole("button", { name: AGENT_API_KEYS_COPY.retryAction });
    await user.tab();
    expect(document.activeElement).toBe(retryButton);
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    expect(refetchKeys).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstRetry.resolve({ isError: true });
      await firstRetry.promise;
    });
    await waitFor(() => {
      expect(
        (screen.getByRole("button", {
          name: AGENT_API_KEYS_COPY.retryAction,
        }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    expect(document.activeElement).toBe(retryButton);

    await user.keyboard(" ");
    expect(refetchKeys).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondRetry.resolve({ isError: true });
      await secondRetry.promise;
    });
  });

  it("restores Retry when refetch throws synchronously", async () => {
    state.keys.isError = true;
    refetchKeys
      .mockImplementationOnce(() => {
        throw new Error("synchronous refetch failure");
      })
      .mockResolvedValueOnce({ isError: true });
    const user = userEvent.setup();
    render(<ApiKeysPane />);

    await user.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.retryAction }));
    await waitFor(() => {
      expect(
        (screen.getByRole("button", {
          name: AGENT_API_KEYS_COPY.retryAction,
        }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    await user.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.retryAction }));
    expect(refetchKeys).toHaveBeenCalledTimes(2);
  });

  it("consumes a rejected refetch and restores Retry", async () => {
    state.keys.isError = true;
    refetchKeys.mockRejectedValueOnce(new Error("rejected refetch failure"));
    const user = userEvent.setup();
    render(<ApiKeysPane />);

    await user.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.retryAction }));

    await waitFor(() => {
      expect(
        (screen.getByRole("button", {
          name: AGENT_API_KEYS_COPY.retryAction,
        }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    expect(refetchKeys).toHaveBeenCalledTimes(1);
  });

  it("does not update Retry state after an in-flight refetch is unmounted", async () => {
    state.keys.isError = true;
    const retry = deferred<unknown>();
    refetchKeys.mockReturnValue(retry.promise);
    const user = userEvent.setup();
    const view = render(<ApiKeysPane />);

    await user.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.retryAction }));
    expect(
      (screen.getByRole("button", {
        name: AGENT_API_KEYS_COPY.retryingAction,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    view.unmount();
    await act(async () => {
      retry.reject(new Error("rejected after unmount"));
      await retry.promise.catch(() => undefined);
    });
    expect(refetchKeys).toHaveBeenCalledTimes(1);
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
