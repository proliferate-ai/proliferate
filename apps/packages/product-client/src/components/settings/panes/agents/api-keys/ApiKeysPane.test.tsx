// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeysPane } from "#product/components/settings/panes/agents/api-keys/ApiKeysPane";
import { AGENT_API_KEYS_COPY } from "#product/copy/settings/agent-api-keys-copy";

const state = vi.hoisted(() => ({
  // Cloud COMPUTE is off for this entire suite, deliberately. The API key vault
  // is a control-plane feature (ADR FM6/Q9), so the pane must render normally
  // for a signed-in user on a reachable control plane even with cloud compute
  // switched off. Re-couple the pane to `cloudActive` and the whole file fails.
  cloudActive: false,
  authStatus: "authenticated" as "authenticated" | "anonymous" | "loading",
  controlPlaneReachable: true,
  keys: {
    data: [] as Array<Record<string, unknown>> | undefined,
    isLoading: false,
    isError: false,
  },
}));
const createMutate = vi.hoisted(() => vi.fn());
const revokeMutate = vi.hoisted(() => vi.fn());
const refetchKeys = vi.hoisted(() => vi.fn());
const keysEnabled = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentApiKeys: (enabled: boolean) => {
    keysEnabled(enabled);
    return { ...state.keys, refetch: refetchKeys };
  },
  useCreateAgentApiKey: () => ({ mutate: createMutate, isPending: false }),
  useRevokeAgentApiKey: () => ({ mutate: revokeMutate, isPending: false }),
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({
    cloudActive: state.cloudActive,
    authStatus: state.authStatus,
    controlPlaneReachable: state.controlPlaneReachable,
  }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (s: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

// ConfirmationDialog and ApiKeyCreatorModal wrap Radix Dialog (no jsdom
// polyfills) — stub both to plain buttons so their flows are exercisable.
vi.mock("#product/primitives/patterns/ConfirmationDialog", () => ({
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

vi.mock("#product/components/settings/panes/agent-auth/ApiKeyCreatorModal", () => ({
  ApiKeyCreatorModal: ({
    open,
    heading,
    onSubmit,
    onClose,
  }: {
    open: boolean;
    heading: string;
    onSubmit: (input: { title: string; value: string; envVarName: string }) => void;
    onClose: () => void;
  }) =>
    open ? (
      <div>
        <div>{heading}</div>
        <button
          type="button"
          onClick={() => onSubmit({ title: "Personal key", value: "sk-ant-123", envVarName: "" })}
        >
          creator-submit
        </button>
        <button type="button" onClick={onClose}>creator-cancel</button>
      </div>
    ) : null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = false;
  state.authStatus = "authenticated";
  state.controlPlaneReachable = true;
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
  it("renders the vault with cloud compute disabled (launch posture)", () => {
    state.cloudActive = false;
    state.keys.data = [key()];
    const { container } = render(<ApiKeysPane />);

    expect(container.querySelector('[data-api-keys-state="ready"]')).not.toBeNull();
    expect(screen.queryByText("Work key")).not.toBeNull();
    expect(keysEnabled).toHaveBeenLastCalledWith(true);
  });

  it("prompts a signed-out user to sign in, without querying the vault", () => {
    state.authStatus = "anonymous";
    const { container } = render(<ApiKeysPane />);

    expect(container.querySelector('[data-api-keys-state="gated"]')).not.toBeNull();
    expect(screen.queryByText(AGENT_API_KEYS_COPY.signInRequiredTitle)).not.toBeNull();
    expect(screen.queryByText(AGENT_API_KEYS_COPY.signInRequired)).not.toBeNull();
    expect(keysEnabled).toHaveBeenLastCalledWith(false);
  });

  it("tells a signed-in user the server is unreachable, not to sign in", () => {
    state.controlPlaneReachable = false;
    const { container } = render(<ApiKeysPane />);

    expect(container.querySelector('[data-api-keys-state="gated"]')).not.toBeNull();
    expect(screen.queryByText(AGENT_API_KEYS_COPY.serverUnreachableTitle)).not.toBeNull();
    expect(screen.queryByText(AGENT_API_KEYS_COPY.serverUnreachable)).not.toBeNull();
    expect(screen.queryByText(AGENT_API_KEYS_COPY.signInRequiredTitle)).toBeNull();
    expect(keysEnabled).toHaveBeenLastCalledWith(false);
  });

  it("lists vault keys by title and redacted hint", () => {
    state.keys.data = [key(), key({ id: "key-2", title: "Backup", redactedHint: "sk-...wxyz" })];
    render(<ApiKeysPane />);

    expect(screen.queryByText("Work key")).not.toBeNull();
    expect(screen.queryByText("sk-...abcd")).not.toBeNull();
    expect(screen.queryByText("Backup")).not.toBeNull();
  });

  it("shows the empty state with the header Add key action", () => {
    const { container } = render(<ApiKeysPane />);

    expect(screen.queryByText(AGENT_API_KEYS_COPY.emptyTitle)).not.toBeNull();
    const addButton = screen.getByRole("button", { name: AGENT_API_KEYS_COPY.addAction });
    expect(addButton.getAttribute("type")).toBe("button");
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
    expect(retryButton.getAttribute("type")).toBe("button");
    expect(screen.queryByText(AGENT_API_KEYS_COPY.loadError)).not.toBeNull();

    await user.click(retryButton);
    await user.click(retryButton);

    expect(refetchKeys).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("button", {
        name: AGENT_API_KEYS_COPY.retryingAction,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

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
    retryButton.focus();
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

  it("creates a key through the Add key modal", () => {
    render(<ApiKeysPane />);

    expect(screen.queryByText(AGENT_API_KEYS_COPY.addModalHeading)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.addAction }));
    expect(screen.queryByText(AGENT_API_KEYS_COPY.addModalHeading)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "creator-submit" }));

    expect(createMutate).toHaveBeenCalledWith(
      { title: "Personal key", value: "sk-ant-123" },
      expect.anything(),
    );
  });

  it("closes the Add key modal and toasts on success", () => {
    createMutate.mockImplementation((_input, cbs) => cbs.onSuccess({ title: "Personal key" }));
    render(<ApiKeysPane />);

    fireEvent.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.addAction }));
    fireEvent.click(screen.getByRole("button", { name: "creator-submit" }));

    expect(screen.queryByText(AGENT_API_KEYS_COPY.addModalHeading)).toBeNull();
    expect(showToast).toHaveBeenCalledWith("Added API key Personal key.", "info");
  });

  it("keeps the Add key modal open and toasts on failure", () => {
    createMutate.mockImplementation((_input, cbs) => cbs.onError(new Error("nope")));
    render(<ApiKeysPane />);

    fireEvent.click(screen.getByRole("button", { name: AGENT_API_KEYS_COPY.addAction }));
    fireEvent.click(screen.getByRole("button", { name: "creator-submit" }));

    expect(screen.queryByText(AGENT_API_KEYS_COPY.addModalHeading)).not.toBeNull();
    expect(showToast).toHaveBeenCalledWith("nope");
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
