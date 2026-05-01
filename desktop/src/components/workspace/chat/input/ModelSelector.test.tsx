// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNativeOverlayOpen } from "@/hooks/ui/use-native-overlay-presence";
import { ModelSelector } from "./ModelSelector";

const modelSelectorMenuMock = vi.hoisted(() => {
  const createState = () => ({
    open: false,
    addProviderOpen: false,
    setupAgent: null,
    search: "",
    triggerRef: { current: null } as { current: HTMLButtonElement | null },
    menuPos: null as { bottom: number; left: number } | null,
    filteredGroups: [],
    setSearch: vi.fn(),
    handleOpen: vi.fn(),
    handleClose: vi.fn(),
    toggleAddProvider: vi.fn(),
    openSetupAgent: vi.fn(),
    closeSetupAgent: vi.fn(),
  });

  return {
    createState,
    state: createState(),
  };
});

vi.mock("@/hooks/chat/use-model-selector-menu", () => ({
  useModelSelectorMenu: () => modelSelectorMenuMock.state,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  modelSelectorMenuMock.state = modelSelectorMenuMock.createState();
});

function NativeOverlayObserver() {
  const open = useNativeOverlayOpen();
  return <div data-testid="native-overlay-state" data-open={String(open)} />;
}

describe("ModelSelector", () => {
  it("registers as a native overlay while its menu portal is open", async () => {
    modelSelectorMenuMock.state = {
      ...modelSelectorMenuMock.createState(),
      open: true,
      menuPos: { bottom: 12, left: 24 },
    };

    const rendered = render(
      <>
        <NativeOverlayObserver />
        <ModelSelector
          connectionState="healthy"
          currentModel={null}
          groups={[]}
          hasAgents
          isLoading={false}
          notReadyAgents={[]}
          onSelect={vi.fn()}
        />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("true");
    });

    modelSelectorMenuMock.state = modelSelectorMenuMock.createState();
    rendered.rerender(
      <>
        <NativeOverlayObserver />
        <ModelSelector
          connectionState="healthy"
          currentModel={null}
          groups={[]}
          hasAgents
          isLoading={false}
          notReadyAgents={[]}
          onSelect={vi.fn()}
        />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("false");
    });
  });

  it("does not register a stale open menu when the selector is disabled", async () => {
    const handleClose = vi.fn();
    modelSelectorMenuMock.state = {
      ...modelSelectorMenuMock.createState(),
      open: true,
      menuPos: { bottom: 12, left: 24 },
      handleClose,
    };

    render(
      <>
        <NativeOverlayObserver />
        <ModelSelector
          connectionState="connecting"
          currentModel={null}
          groups={[]}
          hasAgents
          isLoading={false}
          notReadyAgents={[]}
          onSelect={vi.fn()}
        />
      </>,
    );

    expect(screen.getByTestId("native-overlay-state").dataset.open).toBe("false");
    await waitFor(() => {
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });
});
