// @vitest-environment jsdom

import { cleanup, render as renderBase, screen, waitFor, type RenderOptions } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNativeOverlayOpen } from "@proliferate/ui/overlays/overlay-presence";
import type { ModelSelectorGroup } from "@/lib/domain/chat/models/model-selector-types";
import { ModelSelector } from "./ModelSelector";

const modelSelectorMenuMock = vi.hoisted(() => {
  const createState = () => ({
    open: false,
    search: "",
    triggerRef: { current: null } as { current: HTMLButtonElement | null },
    menuPos: null as { bottom: number; left: number } | null,
    filteredGroups: [] as ModelSelectorGroup[],
    setSearch: vi.fn(),
    handleOpen: vi.fn(),
    handleClose: vi.fn(),
  });

  return {
    createState,
    state: createState(),
  };
});

vi.mock("@/hooks/chat/ui/use-model-selector-menu", () => ({
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

// ModelSelector navigates to settings via useNavigate, so renders need a Router.
function render(ui: ReactNode, options?: RenderOptions) {
  return renderBase(ui, { wrapper: MemoryRouter, ...options });
}

describe("ModelSelector", () => {
  it("does not show new-chat badges inside the current provider group", () => {
    const groups = [{
      kind: "gemini",
      providerDisplayName: "Gemini",
      models: [
        {
          kind: "gemini",
          modelId: "gemini-3-pro",
          displayName: "Gemini 3 Pro",
          actionKind: "open_new_chat" as const,
          isSelected: false,
        },
        {
          kind: "gemini",
          modelId: "gemini-3-flash",
          displayName: "Gemini 3 Flash",
          actionKind: "select" as const,
          isSelected: true,
        },
      ],
    }];
    modelSelectorMenuMock.state = {
      ...modelSelectorMenuMock.createState(),
      open: true,
      menuPos: { bottom: 12, left: 24 },
      filteredGroups: groups,
    };

    render(
      <ModelSelector
        connectionState="healthy"
        currentModel={{
          kind: "gemini",
          displayName: "Gemini 3 Flash",
          pendingState: null,
        }}
        groups={groups}
        hasAgents
        isLoading={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Gemini 3 Pro")).toBeTruthy();
    expect(screen.getAllByText("Gemini 3 Flash").length).toBeGreaterThan(0);
    expect(screen.queryByText("New chat")).toBeNull();
  });

  it("does not show new-chat badges inside the current provider group when the checked row is absent", () => {
    const groups = [{
      kind: "gemini",
      providerDisplayName: "Gemini",
      models: [
        {
          kind: "gemini",
          modelId: "gemini-2.5-pro",
          displayName: "Gemini 2.5 Pro",
          actionKind: "open_new_chat" as const,
          isSelected: false,
        },
        {
          kind: "gemini",
          modelId: "gemini-3-pro",
          displayName: "Gemini 3 Pro",
          actionKind: "open_new_chat" as const,
          isSelected: false,
        },
      ],
    }];
    modelSelectorMenuMock.state = {
      ...modelSelectorMenuMock.createState(),
      open: true,
      menuPos: { bottom: 12, left: 24 },
      filteredGroups: groups,
    };

    render(
      <ModelSelector
        connectionState="healthy"
        currentModel={{
          kind: "gemini",
          displayName: "Gemini 3 Flash",
          pendingState: null,
        }}
        groups={groups}
        hasAgents
        isLoading={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Gemini 2.5 Pro")).toBeTruthy();
    expect(screen.getByText("Gemini 3 Pro")).toBeTruthy();
    expect(screen.queryByText("New chat")).toBeNull();
  });

  it("keeps the new-chat badge for other provider groups", () => {
    const groups = [
      {
        kind: "gemini",
        providerDisplayName: "Gemini",
        models: [{
          kind: "gemini",
          modelId: "gemini-3-flash",
          displayName: "Gemini 3 Flash",
          actionKind: "select" as const,
          isSelected: true,
        }],
      },
      {
        kind: "claude",
        providerDisplayName: "Claude",
        models: [{
          kind: "claude",
          modelId: "opus-4-8",
          displayName: "Opus 4.8",
          actionKind: "open_new_chat" as const,
          isSelected: false,
        }],
      },
    ];
    modelSelectorMenuMock.state = {
      ...modelSelectorMenuMock.createState(),
      open: true,
      menuPos: { bottom: 12, left: 24 },
      filteredGroups: groups,
    };

    render(
      <ModelSelector
        connectionState="healthy"
        currentModel={{
          kind: "gemini",
          displayName: "Gemini 3 Flash",
          pendingState: null,
        }}
        groups={groups}
        hasAgents
        isLoading={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Opus 4.8")).toBeTruthy();
    expect(screen.getByText("New chat")).toBeTruthy();
  });

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
