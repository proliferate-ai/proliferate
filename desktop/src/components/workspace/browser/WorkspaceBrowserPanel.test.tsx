/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceBrowserPanel } from "@/components/workspace/browser/WorkspaceBrowserPanel";
import { openExternal } from "@/lib/access/tauri/shell";
import {
  closeBrowserWebview,
  ensureBrowserWebview,
  hideBrowserWebview,
  isBrowserWebviewAvailable,
} from "@/lib/access/tauri/browser-webview";

const browserWebviewMocks = vi.hoisted(() => ({
  closeBrowserWebview: vi.fn(async () => undefined),
  ensureBrowserWebview: vi.fn(async () => undefined),
  hideBrowserWebview: vi.fn(async () => undefined),
  isBrowserWebviewAvailable: vi.fn(() => false),
  browserWebviewLabel: vi.fn((workspaceId: string | null, browserId: string) =>
    `workspace-browser-${workspaceId ?? "workspace"}-${browserId}`
  ),
}));

vi.mock("@/lib/access/tauri/shell", () => ({
  copyPath: vi.fn(async () => undefined),
  copyText: vi.fn(async () => undefined),
  getHomeDir: vi.fn(async () => "/Users/pablo"),
  listAvailableEditors: vi.fn(async () => []),
  listOpenTargets: vi.fn(async () => []),
  openEmailCompose: vi.fn(async () => undefined),
  openExternal: vi.fn(async () => undefined),
  openGmailCompose: vi.fn(async () => undefined),
  openInEditor: vi.fn(async () => undefined),
  openInTerminal: vi.fn(async () => undefined),
  openOutlookCompose: vi.fn(async () => undefined),
  openTarget: vi.fn(async () => undefined),
  pickFolder: vi.fn(async () => null),
  revealInFinder: vi.fn(async () => undefined),
}));

vi.mock("@/lib/access/tauri/browser-webview", () => browserWebviewMocks);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(isBrowserWebviewAvailable).mockReturnValue(false);
});

describe("WorkspaceBrowserPanel", () => {
  it("renders a blank browser tab and commits normalized URLs", () => {
    const onUpdateUrl = vi.fn();
    render(
      <WorkspaceBrowserPanel
        workspaceId="workspace-1"
        tabs={[{ id: "b1", url: null }]}
        activeBrowserId="b1"
        isVisible
        onUpdateUrl={onUpdateUrl}
      />,
    );

    expect(screen.getByText("Enter a URL above. Ports like 3000 open localhost.")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Enter URL or localhost port"), {
      target: { value: "3000" },
    });
    fireEvent.submit(screen.getByPlaceholderText("Enter URL or localhost port").closest("form")!);

    expect(onUpdateUrl).toHaveBeenCalledWith("b1", "http://localhost:3000/");
  });

  it("renders iframe safety attributes from the committed URL", () => {
    const { container } = render(
      <WorkspaceBrowserPanel
        workspaceId="workspace-1"
        tabs={[
          { id: "local", url: "http://192.168.1.10:3000/" },
          { id: "external", url: "https://example.com/" },
        ]}
        activeBrowserId="local"
        isVisible
        onUpdateUrl={vi.fn()}
      />,
    );

    const iframes = Array.from(container.querySelectorAll("iframe"));
    expect(container.querySelector("[data-telemetry-block]")).toBeTruthy();
    expect(iframes).toHaveLength(2);
    expect(iframes[0]?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms allow-same-origin",
    );
    expect(iframes[0]?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframes[0]?.getAttribute("allow")).toBe("");
    expect(iframes[1]?.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
  });

  it("reloads instead of updating state when submitting the current URL", async () => {
    const onUpdateUrl = vi.fn();
    const { container } = render(
      <WorkspaceBrowserPanel
        workspaceId="workspace-1"
        tabs={[{ id: "b1", url: "http://localhost:3000/" }]}
        activeBrowserId="b1"
        isVisible
        onUpdateUrl={onUpdateUrl}
      />,
    );
    const initialFrame = container.querySelector("iframe");
    expect(initialFrame).toBeTruthy();

    fireEvent.load(initialFrame!);
    expect(screen.getByTitle("Reload")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Enter URL or localhost port"), {
      target: { value: "localhost:3000" },
    });
    fireEvent.submit(screen.getByPlaceholderText("Enter URL or localhost port").closest("form")!);

    expect(onUpdateUrl).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector("iframe")).not.toBe(initialFrame);
    });
    expect(screen.getByTitle("Loading")).toBeTruthy();

    fireEvent.load(container.querySelector("iframe")!);
    expect(screen.getByTitle("Reload")).toBeTruthy();
  });

  it("keeps inactive iframes mounted but hidden and non-interactive", () => {
    const { container, rerender } = render(
      <WorkspaceBrowserPanel
        workspaceId="workspace-1"
        tabs={[
          { id: "b1", url: "https://example.com/" },
          { id: "b2", url: "https://example.org/" },
        ]}
        activeBrowserId="b1"
        isVisible
        onUpdateUrl={vi.fn()}
      />,
    );

    const inactiveFrameShell = container.querySelectorAll("iframe")[1]?.parentElement;
    expect(container.querySelectorAll("iframe")).toHaveLength(2);
    expect(inactiveFrameShell?.getAttribute("aria-hidden")).toBe("true");
    expect(inactiveFrameShell?.getAttribute("tabindex")).toBe("-1");
    expect(inactiveFrameShell?.className).toContain("pointer-events-none");

    rerender(
      <WorkspaceBrowserPanel
        workspaceId="workspace-1"
        tabs={[{ id: "b1", url: "https://example.com/" }]}
        activeBrowserId="b1"
        isVisible
        onUpdateUrl={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("shows timeout fallback, clears it on load, and opens externally only on explicit action", () => {
    vi.useFakeTimers();
    const { container } = render(
      <WorkspaceBrowserPanel
        workspaceId="workspace-1"
        tabs={[{ id: "b1", url: "https://example.com/" }]}
        activeBrowserId="b1"
        isVisible
        onUpdateUrl={vi.fn()}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText("This site may block embedding.")).toBeTruthy();

    fireEvent.load(container.querySelector("iframe")!);
    expect(screen.queryByText("This site may block embedding.")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    fireEvent.click(screen.getByTitle("Open externally"));
    expect(openExternal).toHaveBeenCalledWith("https://example.com/");
  });

  it("uses native Tauri webviews when available", async () => {
    vi.mocked(isBrowserWebviewAvailable).mockReturnValue(true);
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 20,
      y: 60,
      left: 20,
      top: 60,
      right: 420,
      bottom: 360,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    } as DOMRect));

    try {
      const { container, unmount } = render(
        <WorkspaceBrowserPanel
          workspaceId="workspace-1"
          tabs={[{ id: "b1", url: "https://google.com/" }]}
          activeBrowserId="b1"
          isVisible
          onUpdateUrl={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(ensureBrowserWebview).toHaveBeenCalledWith({
          label: "workspace-browser-workspace-1-b1",
          url: "https://google.com/",
          bounds: { x: 20, y: 60, width: 400, height: 300 },
          visible: true,
          reloadKey: 0,
        });
      });
      expect(container.querySelector("iframe")).toBeNull();

      unmount();
      expect(closeBrowserWebview).toHaveBeenCalledWith("workspace-browser-workspace-1-b1");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  it("hides native webviews while header overlays are open", async () => {
    vi.mocked(isBrowserWebviewAvailable).mockReturnValue(true);
    render(
      <WorkspaceBrowserPanel
        workspaceId="workspace-1"
        tabs={[{ id: "b1", url: "http://localhost:3000/" }]}
        activeBrowserId="b1"
        isVisible
        nativeOverlaysHidden
        onUpdateUrl={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(hideBrowserWebview).toHaveBeenCalledWith("workspace-browser-workspace-1-b1");
    });
    expect(ensureBrowserWebview).not.toHaveBeenCalled();
  });

  it("does not fall back to iframe when native Tauri webview creation fails", async () => {
    vi.mocked(isBrowserWebviewAvailable).mockReturnValue(true);
    vi.mocked(ensureBrowserWebview).mockRejectedValueOnce(new Error("create failed"));
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 20,
      y: 60,
      left: 20,
      top: 60,
      right: 420,
      bottom: 360,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    } as DOMRect));

    try {
      const { container } = render(
        <WorkspaceBrowserPanel
          workspaceId="workspace-1"
          tabs={[{ id: "b1", url: "https://google.com/" }]}
          activeBrowserId="b1"
          isVisible
          onUpdateUrl={vi.fn()}
        />,
      );

      await screen.findByText("This page could not be opened.");
      expect(container.querySelector("iframe")).toBeNull();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });
});
