// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { harnessStatusFixture } from "#product/hooks/access/anyharness/agent-auth/use-harness-status.fixtures";
import { HarnessProvidersSection } from "./HarnessProvidersSection";

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCreateAgentApiKey: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeAgentApiKey: () => ({ mutate: vi.fn() }),
}));

vi.mock("#product/config/provider-logos.generated", () => ({
  PROVIDER_LOGO_URLS: {},
}));

// OpenCode's badge is the runtime's status document now, not the old
// unconditional green: `deriveProvidersStatus` is deleted.
vi.mock("#product/hooks/access/anyharness/agent-auth/use-harness-status", () => ({
  useHarnessStatus: () => harnessStatusFixture(),
}));

// The provider-picker chunk carries a 170+-mark asset map: stub a deliberate
// delay so the test can observe the trigger's pending window rather than
// racing a same-tick module-cache resolution.
vi.mock(
  "#product/components/settings/panes/agents/harness/ProviderPickerModal",
  () =>
    new Promise((resolve) => {
      setTimeout(
        () =>
          resolve({
            ProviderPickerModal: () => <div data-testid="provider-picker-modal" />,
          }),
        50,
      );
    }),
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeEditor(overrides: Partial<HarnessAuthEditorApi> = {}): HarnessAuthEditorApi {
  return {
    authReady: true,
    capabilitiesQuery: {} as never,
    enrollmentQuery: {} as never,
    selectionsQuery: { isFetching: false, refetch: vi.fn() } as never,
    apiKeysQuery: { isFetching: false, data: [], refetch: vi.fn() } as never,
    deliveryPending: false,
    gatewayLocked: false,
    harnessDisallowed: false,
    gatewayDisallowed: false,
    apiKeyDisallowed: false,
    nativeDisallowed: false,
    multiSource: false,
    busy: false,
    editorState: { rows: [] } as never,
    native: false,
    addBoundApiKey: vi.fn(),
    handleRemoveRow: vi.fn(),
    ...overrides,
  } as unknown as HarnessAuthEditorApi;
}

describe("HarnessProvidersSection", () => {
  it("shows a pending trigger instead of letting the modal pop in blank late", async () => {
    render(<HarnessProvidersSection editor={makeEditor()} />);

    const trigger = screen.getByRole("button", { name: /configure/i }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);

    fireEvent.click(trigger);

    // Class B: the trigger itself carries the wait, never a blank modal pop.
    expect(trigger.disabled).toBe(true);
    expect(screen.queryByTestId("provider-picker-modal")).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(await screen.findByTestId("provider-picker-modal")).not.toBeNull();
    expect(trigger.disabled).toBe(false);
  });

  it("resets the trigger and surfaces an error when the chunk import rejects", async () => {
    vi.resetModules();
    vi.doMock(
      "#product/components/settings/panes/agents/harness/ProviderPickerModal",
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("chunk load failed")), 20);
        }),
    );
    const { HarnessProvidersSection: SectionWithRejectingImport } = await import(
      "./HarnessProvidersSection"
    );

    render(<SectionWithRejectingImport editor={makeEditor()} />);

    const trigger = screen.getByRole("button", { name: /configure/i }) as HTMLButtonElement;
    fireEvent.click(trigger);
    expect(trigger.disabled).toBe(true);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    // The button must reset so a retry is possible, and the modal must never
    // have appeared.
    expect(trigger.disabled).toBe(false);
    expect(screen.queryByTestId("provider-picker-modal")).toBeNull();
    expect(screen.getByRole("alert")).not.toBeNull();
  });
});
