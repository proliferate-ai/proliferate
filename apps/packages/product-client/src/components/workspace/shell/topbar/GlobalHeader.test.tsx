// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopBridge,
  DesktopFilesBridge,
  OpenTarget,
} from "@proliferate/product-client/host/desktop-bridge";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { GlobalHeader } from "#product/components/workspace/shell/topbar/GlobalHeader";
import { makeTestProductHost } from "#product/test/product-host-fixtures";

const pathMocks = vi.hoisted(() => ({
  value: {
    materializedWorkspaceId: "workspace-1" as string | null,
    filesystemOrigin: { status: "settled" as string, origin: "desktop-local" as string | null },
    workspaceRoot: { status: "settled" as string, path: "/repo" as string | null },
  },
}));

const statMocks = vi.hoisted(() => ({
  calls: vi.fn(),
  data: { kind: "directory" as "file" | "directory" | "symlink" } as
    | { kind: "file" | "directory" | "symlink" }
    | undefined,
  error: null as unknown,
  isPending: false,
}));

const shellMocks = vi.hoisted(() => ({
  splitOnClick: null as (() => void) | null,
  splitOnTargetClick: null as ((target: OpenTarget) => void) | null,
  splitTargets: [] as OpenTarget[],
}));

vi.mock("#product/providers/WorkspacePathProvider", () => ({
  useWorkspacePath: () => pathMocks.value,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useStatWorkspaceFileQuery: (input: unknown) => {
    statMocks.calls(input);
    return {
      data: statMocks.data,
      error: statMocks.error,
      isPending: statMocks.isPending,
      isFetching: false,
    };
  },
}));

vi.mock("#product/hooks/access/anyharness/files/use-workspace-file-lookup", () => ({
  useWorkspaceFileLookup: () => ({ statFile: vi.fn() }),
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-fuzzy-file-resolver", () => ({
  useFuzzyFileResolver: () => vi.fn(async () => ({ status: "no-match" })),
}));

vi.mock("#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation", () => ({
  useWorkspaceShellActivation: () => ({ activateViewerTarget: vi.fn() }),
}));

vi.mock("#product/stores/editor/workspace-viewer-tabs-store", () => ({
  useWorkspaceViewerTabsStore: (selector: (state: { openTarget: () => void }) => unknown) =>
    selector({ openTarget: vi.fn() }),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (
    selector: (state: {
      selectedWorkspaceId: string;
      selectedLogicalWorkspaceId: string;
    }) => unknown,
  ) => selector({
    selectedWorkspaceId: "workspace-1",
    selectedLogicalWorkspaceId: "workspace-1",
  }),
}));

vi.mock("#product/stores/preferences/user-preferences-store", () => ({
  useUserPreferencesStore: (selector: (state: { defaultOpenInTargetId: string }) => unknown) =>
    selector({ defaultOpenInTargetId: "cursor" }),
}));

vi.mock("#product/components/workspace/shell/topbar/HeaderTabs", () => ({ HeaderTabs: () => null }));
vi.mock("#product/components/workspace/shell/topbar/WorkspaceActionsMenuContainer", () => ({
  WorkspaceActionsMenuContainer: () => null,
}));
vi.mock("#product/components/diagnostics/DebugProfiler", () => ({
  DebugProfiler: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("#product/hooks/ui/debug/use-debug-render-count", () => ({
  useDebugRenderCount: () => undefined,
}));
vi.mock("#product/components/workspace/open-target/SplitButton", () => ({
  SplitButton: ({
    onClick,
    onTargetClick,
    targets = [],
  }: {
    onClick?: () => void;
    onTargetClick?: (target: OpenTarget) => void;
    targets?: OpenTarget[];
  }) => {
    shellMocks.splitOnClick = onClick ?? null;
    shellMocks.splitOnTargetClick = onTargetClick ?? null;
    shellMocks.splitTargets = targets;
    return (
      <>
        <button type="button" onClick={onClick}>Open native target</button>
        {targets.map((target) => (
          <button key={target.id} type="button" onClick={() => onTargetClick?.(target)}>
            {target.label}
          </button>
        ))}
      </>
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  pathMocks.value = {
    materializedWorkspaceId: "workspace-1",
    filesystemOrigin: { status: "settled", origin: "desktop-local" },
    workspaceRoot: { status: "settled", path: "/repo" },
  };
  statMocks.data = { kind: "directory" };
  statMocks.error = null;
  statMocks.isPending = false;
  shellMocks.splitOnClick = null;
  shellMocks.splitOnTargetClick = null;
  shellMocks.splitTargets = [];
});

describe("GlobalHeader", () => {
  it("keeps the inventory path display-only while using the authority-proven root", async () => {
    const fixture = desktopFixture();
    renderHeader(fixture.host, "/inventory/lookalike");

    expect(screen.getByTitle("lookalike").style.fontSize).toBe("var(--text-workspace-title)");
    expect(statMocks.calls).toHaveBeenLastCalledWith(expect.objectContaining({ path: "" }));
    await waitFor(() => expect(fixture.listOpenTargets).toHaveBeenCalledWith("directory"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open native target" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Open native target" }));
    await waitFor(() => expect(fixture.openTarget).toHaveBeenCalledWith("cursor", "/repo"));
    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() => expect(fixture.copy).toHaveBeenCalledWith("/repo"));
    expect(fixture.openTarget).not.toHaveBeenCalledWith(expect.anything(), "/inventory/lookalike");
  });

  it("falls back to authority-proven root reveal when no open target exists", async () => {
    const fixture = desktopFixture([]);
    renderHeader(fixture.host);
    await waitFor(() => expect(fixture.listOpenTargets).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Open native target" }));
    await waitFor(() => expect(fixture.reveal).toHaveBeenCalledWith("/repo"));
  });

  it.each([
    ["remote", { status: "settled", origin: "remote" }, { status: "settled", path: "/repo" }, "directory", true],
    ["origin pending", { status: "pending", origin: null }, { status: "settled", path: "/repo" }, "directory", true],
    ["origin rejected", { status: "rejected", origin: null }, { status: "settled", path: "/repo" }, "directory", true],
    ["root pending", { status: "settled", origin: "desktop-local" }, { status: "pending", path: null }, "directory", true],
    ["root unavailable", { status: "settled", origin: "desktop-local" }, { status: "unavailable", path: null }, "directory", true],
    ["Web local", { status: "settled", origin: "desktop-local" }, { status: "settled", path: "/repo" }, "directory", false],
    ["Web remote", { status: "settled", origin: "remote" }, { status: "settled", path: "/repo" }, "directory", false],
    ["non-directory", { status: "settled", origin: "desktop-local" }, { status: "settled", path: "/repo" }, "file", true],
    ["unexpected kind", { status: "settled", origin: "desktop-local" }, { status: "settled", path: "/repo" }, "symlink", true],
  ] as const)("offers no native root action for %s", async (_label, origin, root, kind, desktop) => {
    pathMocks.value = {
      materializedWorkspaceId: "workspace-1",
      filesystemOrigin: origin,
      workspaceRoot: root,
    };
    statMocks.data = { kind };
    const fixture = desktopFixture();
    renderHeader(desktop ? fixture.host : makeTestProductHost(), "/inventory/local-looking");
    await act(async () => Promise.resolve());

    expect(screen.queryByRole("button", { name: "Open native target" })).toBeNull();
    expect(fixture.listOpenTargets).not.toHaveBeenCalled();
    expect(fixture.openTarget).not.toHaveBeenCalled();
    expect(fixture.reveal).not.toHaveBeenCalled();
    expect(fixture.copy).not.toHaveBeenCalled();
  });

  it("keeps the root action hidden while exact stat is pending or refused", async () => {
    const fixture = desktopFixture();
    statMocks.data = undefined;
    statMocks.isPending = true;
    const view = renderHeader(fixture.host);
    expect(screen.queryByRole("button", { name: "Open native target" })).toBeNull();
    expect(fixture.listOpenTargets).not.toHaveBeenCalled();

    statMocks.isPending = false;
    statMocks.error = new Error("refused");
    view.rerender(headerTree(fixture.host));
    await act(async () => Promise.resolve());
    expect(screen.queryByRole("button", { name: "Open native target" })).toBeNull();
    expect(fixture.listOpenTargets).not.toHaveBeenCalled();
  });

  it("fails closed when local root callbacks become stale", async () => {
    const fixture = desktopFixture();
    const view = renderHeader(fixture.host);
    await waitFor(() => expect(fixture.listOpenTargets).toHaveBeenCalledOnce());
    const staleDefault = shellMocks.splitOnClick!;
    const staleTarget = shellMocks.splitOnTargetClick!;
    const staleCopyTarget = shellMocks.splitTargets.find((target) => target.kind === "copy")!;
    const staleEditorTarget = shellMocks.splitTargets.find((target) => target.kind === "editor")!;
    fixture.openTarget.mockClear();
    fixture.reveal.mockClear();
    fixture.copy.mockClear();

    pathMocks.value = {
      ...pathMocks.value,
      workspaceRoot: { status: "settled", path: "/different" },
    };
    view.rerender(headerTree(fixture.host));
    await act(async () => {
      staleDefault();
      staleTarget(staleCopyTarget);
      staleTarget(staleEditorTarget);
      await Promise.resolve();
    });

    expect(fixture.openTarget).not.toHaveBeenCalled();
    expect(fixture.reveal).not.toHaveBeenCalled();
    expect(fixture.copy).not.toHaveBeenCalled();
  });

  it.each(["selection", "origin", "bridge", "kind"] as const)(
    "fails closed when a callback predates a %s change",
    async (change) => {
      const fixture = desktopFixture();
      const view = renderHeader(fixture.host);
      await waitFor(() => expect(fixture.listOpenTargets).toHaveBeenCalledOnce());
      const staleDefault = shellMocks.splitOnClick!;
      const staleTarget = shellMocks.splitOnTargetClick!;
      const editorTarget = shellMocks.splitTargets.find((target) => target.kind === "editor")!;
      fixture.openTarget.mockClear();
      fixture.reveal.mockClear();

      let nextHost = fixture.host;
      if (change === "selection") {
        pathMocks.value = { ...pathMocks.value, materializedWorkspaceId: "workspace-2" };
      } else if (change === "origin") {
        pathMocks.value = {
          ...pathMocks.value,
          filesystemOrigin: { status: "settled", origin: "remote" },
        };
      } else if (change === "bridge") {
        nextHost = desktopFixture().host;
      } else {
        statMocks.data = { kind: "file" };
      }
      view.rerender(headerTree(nextHost));
      await act(async () => {
        staleDefault();
        staleTarget(editorTarget);
        await Promise.resolve();
      });

      expect(fixture.openTarget).not.toHaveBeenCalled();
      expect(fixture.reveal).not.toHaveBeenCalled();
    },
  );
});

function renderHeader(host: ProductHost, displayWorkspacePath = "/repo") {
  return render(headerTree(host, displayWorkspacePath));
}

function headerTree(host: ProductHost, displayWorkspacePath = "/repo") {
  return (
    <ProductHostProvider host={host}>
      <GlobalHeader
        selectedWorkspace={undefined}
        displayWorkspacePath={displayWorkspacePath}
        onRun={vi.fn()}
      />
    </ProductHostProvider>
  );
}

function desktopFixture(targets: OpenTarget[] = [
  { id: "cursor", label: "Cursor", kind: "editor", iconId: "cursor" },
]) {
  const listOpenTargets = vi.fn(async () => targets);
  const openTarget = vi.fn(async () => undefined);
  const reveal = vi.fn(async () => undefined);
  const copy = vi.fn(async () => undefined);
  const files = {
    listOpenTargets,
    openTarget,
    reveal,
    getHomeDirectory: vi.fn(async () => "/Users/pablo"),
    inspectPath: vi.fn(async () => ({ kind: "directory" as const })),
  } as unknown as DesktopFilesBridge;
  const host = makeTestProductHost({
    desktop: { files } as unknown as DesktopBridge,
    overrides: { clipboard: { writeText: copy } },
  });
  return { host, listOpenTargets, openTarget, reveal, copy };
}
