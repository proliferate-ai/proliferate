// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";

import { useNativeContextMenu } from "#product/hooks/ui/native/use-native-context-menu";

afterEach(() => {
  cleanup();
});

function makeHost(desktop: DesktopBridge | null): ProductHost {
  return {
    surface: desktop ? "desktop" : "web",
    deployment: { apiBaseUrl: "https://api.example.test" },
    auth: {
      authRequired: true,
      state: { status: "loading" },
      restoreSession: async () => {},
      startLogin: async () => ({ provider: "github", source: "desktop_callback" }),
      finishLogin: async () => {},
      cancelLogin: async () => {},
      logout: async () => ({ provider: "github" }),
    },
    cloud: { client: null, getSandboxGatewayAccessToken: async () => "test-token" },
    storage: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
    links: {
      openExternal: async () => {},
      buildReturnUrl: () => "",
      observeInboundEntries: () => () => {},
    },
    clipboard: { writeText: async () => {} },
    telemetry: {
      track: () => {},
      captureException: () => {},
      setUser: () => {},
      setTag: () => {},
      routeChanged: () => {},
      getSupportContext: () => ({ clientReleaseId: "test" }),
      getAnonymousInstallId: async () => null,
    },
    desktop,
  };
}

function makeDesktopBridge(showContextMenu: DesktopBridge["nativeUi"]["showContextMenu"]): DesktopBridge {
  return {
    nativeUi: { showContextMenu },
  } as unknown as DesktopBridge;
}

function Harness({
  buildItems,
  onDomMenu,
  preserveContextualSelection,
}: {
  buildItems: () => Array<{ id: string; label: string }>;
  onDomMenu: () => void;
  preserveContextualSelection?: boolean;
}) {
  const { onContextMenuCapture, showNativeMenu } = useNativeContextMenu(buildItems, {
    preserveContextualSelection,
  });

  return (
    <div
      data-testid="target"
      onContextMenuCapture={onContextMenuCapture}
    >
      <button
        type="button"
        data-testid="child"
        onClick={() => void showNativeMenu()}
        onContextMenu={onDomMenu}
      >
        Open
      </button>
    </div>
  );
}

function renderHarness({
  desktop,
  buildItems = () => [{ id: "item", label: "Item" }],
  onDomMenu = vi.fn(),
  preserveContextualSelection,
}: {
  desktop: DesktopBridge | null;
  buildItems?: () => Array<{ id: string; label: string }>;
  onDomMenu?: () => void;
  preserveContextualSelection?: boolean;
}) {
  return {
    onDomMenu,
    ...render(
      <ProductHostProvider host={makeHost(desktop)}>
        <Harness
          buildItems={buildItems}
          onDomMenu={onDomMenu}
          preserveContextualSelection={preserveContextualSelection}
        />
      </ProductHostProvider>,
    ),
  };
}

function selectChildTextNode() {
  const child = screen.getByTestId("child");
  const selection = window.getSelection();
  if (!selection) throw new Error("jsdom selection unavailable");
  const range = document.createRange();
  range.selectNodeContents(child);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe("useNativeContextMenu", () => {
  it("intercepts the DOM event when the Desktop bridge shows a native menu", async () => {
    const showContextMenu = vi.fn().mockResolvedValue(true);
    const { onDomMenu } = renderHarness({
      desktop: makeDesktopBridge(showContextMenu),
    });

    fireEvent.contextMenu(screen.getByTestId("child"));

    await waitFor(() => expect(showContextMenu).toHaveBeenCalledTimes(1));
    expect(showContextMenu).toHaveBeenCalledWith(
      [{ id: "item", label: "Item" }],
      undefined,
    );
    expect(onDomMenu).not.toHaveBeenCalled();
  });

  it("leaves the original DOM event untouched when Desktop is absent", () => {
    const buildItems = vi.fn(() => [{ id: "item", label: "Item" }]);
    const { onDomMenu } = renderHarness({ desktop: null, buildItems });

    fireEvent.contextMenu(screen.getByTestId("child"));

    expect(buildItems).not.toHaveBeenCalled();
    expect(onDomMenu).toHaveBeenCalledTimes(1);
  });

  it("leaves the original DOM event untouched when there are no items", () => {
    const showContextMenu = vi.fn().mockResolvedValue(true);
    const { onDomMenu } = renderHarness({
      desktop: makeDesktopBridge(showContextMenu),
      buildItems: () => [],
    });

    fireEvent.contextMenu(screen.getByTestId("child"));

    expect(showContextMenu).not.toHaveBeenCalled();
    expect(onDomMenu).toHaveBeenCalledTimes(1);
  });

  it("falls back once and disables later native attempts after refusal", async () => {
    const showContextMenu = vi.fn().mockResolvedValue(false);
    const buildItems = vi.fn(() => [{ id: "item", label: "Item" }]);
    const { onDomMenu } = renderHarness({
      desktop: makeDesktopBridge(showContextMenu),
      buildItems,
    });

    fireEvent.contextMenu(screen.getByTestId("child"));

    await waitFor(() => expect(onDomMenu).toHaveBeenCalledTimes(1));
    expect(showContextMenu).toHaveBeenCalledTimes(1);
    expect(buildItems).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.contextMenu(screen.getByTestId("child"));

    expect(showContextMenu).toHaveBeenCalledTimes(1);
    expect(buildItems).toHaveBeenCalledTimes(1);
    expect(onDomMenu).toHaveBeenCalledTimes(2);
  });

  it("clears a contextual selection touching the target once it commits to replacing the menu", () => {
    const showContextMenu = vi.fn().mockResolvedValue(true);
    renderHarness({ desktop: makeDesktopBridge(showContextMenu) });
    const selection = selectChildTextNode();
    expect(selection.isCollapsed).toBe(false);

    fireEvent.contextMenu(screen.getByTestId("child"));

    expect(selection.rangeCount).toBe(0);
  });

  it("preserves the selection when preserveContextualSelection is true", () => {
    const showContextMenu = vi.fn().mockResolvedValue(true);
    renderHarness({
      desktop: makeDesktopBridge(showContextMenu),
      preserveContextualSelection: true,
    });
    const selection = selectChildTextNode();

    fireEvent.contextMenu(screen.getByTestId("child"));

    expect(selection.rangeCount).toBe(1);
  });

  it("does not clear the selection when there is no native UI to replace the menu", () => {
    renderHarness({ desktop: null });
    const selection = selectChildTextNode();

    fireEvent.contextMenu(screen.getByTestId("child"));

    expect(selection.rangeCount).toBe(1);
  });

  it("does not clear the selection when there are no items to show", () => {
    const showContextMenu = vi.fn().mockResolvedValue(true);
    renderHarness({
      desktop: makeDesktopBridge(showContextMenu),
      buildItems: () => [],
    });
    const selection = selectChildTextNode();

    fireEvent.contextMenu(screen.getByTestId("child"));

    expect(selection.rangeCount).toBe(1);
    expect(showContextMenu).not.toHaveBeenCalled();
  });

  it("stays cleared when native display rejects and re-dispatches the DOM fallback", async () => {
    const showContextMenu = vi.fn().mockResolvedValue(false);
    const { onDomMenu } = renderHarness({ desktop: makeDesktopBridge(showContextMenu) });
    const selection = selectChildTextNode();

    fireEvent.contextMenu(screen.getByTestId("child"));

    expect(selection.rangeCount).toBe(0);
    await waitFor(() => expect(onDomMenu).toHaveBeenCalledTimes(1));
    expect(selection.rangeCount).toBe(0);
  });
});
