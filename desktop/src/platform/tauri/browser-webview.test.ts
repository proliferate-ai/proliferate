/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeBrowserWebview,
  ensureBrowserWebview,
} from "@/platform/tauri/browser-webview";

const webviewMocks = vi.hoisted(() => {
  class MockLogicalPosition {
    x: number;
    y: number;

    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  }

  class MockLogicalSize {
    width: number;
    height: number;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
  }

  class MockWebview {
    static instances: MockWebview[] = [];
    static async getByLabel(label: string): Promise<MockWebview | null> {
      return MockWebview.instances.find((instance) => (
        instance.label === label && !instance.closed
      )) ?? null;
    }

    label: string;
    options: Record<string, unknown>;
    listeners = new Map<string, Array<(event: { payload: unknown }) => void>>();
    closed = false;
    close = vi.fn(async () => {
      this.closed = true;
    });
    hide = vi.fn(async () => undefined);
    show = vi.fn(async () => undefined);
    setFocus = vi.fn(async () => undefined);
    setPosition = vi.fn(async () => undefined);
    setSize = vi.fn(async () => undefined);

    constructor(_window: unknown, label: string, options: Record<string, unknown>) {
      this.label = label;
      this.options = options;
      MockWebview.instances.push(this);
      queueMicrotask(() => this.emit("tauri://created", null));
    }

    async once<T>(
      event: string,
      handler: (event: { payload: T }) => void,
    ): Promise<() => void> {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(handler as (event: { payload: unknown }) => void);
      this.listeners.set(event, listeners);
      return () => undefined;
    }

    emit(event: string, payload: unknown): void {
      const listeners = this.listeners.get(event) ?? [];
      this.listeners.set(event, []);
      for (const listener of listeners) {
        listener({ payload });
      }
    }
  }

  return {
    MockLogicalPosition,
    MockLogicalSize,
    MockWebview,
  };
});

vi.mock("@tauri-apps/api/webview", () => ({
  Webview: webviewMocks.MockWebview,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: webviewMocks.MockLogicalPosition,
  LogicalSize: webviewMocks.MockLogicalSize,
}));

describe("browser webview platform wrapper", () => {
  beforeEach(async () => {
    webviewMocks.MockWebview.instances = [];
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { metadata: { currentWebview: { label: "main" } } },
    });
    await closeBrowserWebview("browser-test");
  });

  it("coalesces concurrent creation for the same browser label", async () => {
    await Promise.all([
      ensureBrowserWebview({
        label: "browser-test",
        url: "https://google.com/",
        bounds: { x: 0, y: 0, width: 400, height: 300 },
        visible: true,
        reloadKey: 0,
      }),
      ensureBrowserWebview({
        label: "browser-test",
        url: "https://google.com/",
        bounds: { x: 10, y: 20, width: 500, height: 350 },
        visible: true,
        reloadKey: 0,
      }),
    ]);

    expect(webviewMocks.MockWebview.instances).toHaveLength(1);
    expect(webviewMocks.MockWebview.instances[0]?.options).not.toHaveProperty("incognito");
    expect(webviewMocks.MockWebview.instances[0]?.show).toHaveBeenCalledTimes(2);
  });

  it("adopts an existing native webview with the same label", async () => {
    const existing = new webviewMocks.MockWebview({}, "browser-test", {
      url: "https://google.com/",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });

    await ensureBrowserWebview({
      label: "browser-test",
      url: "https://google.com/",
      bounds: { x: 10, y: 20, width: 500, height: 350 },
      visible: true,
      reloadKey: 0,
    });

    expect(webviewMocks.MockWebview.instances).toHaveLength(1);
    expect(existing.setPosition).toHaveBeenCalledTimes(1);
    expect(existing.setSize).toHaveBeenCalledTimes(1);
    expect(existing.show).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight close before recreating a label", async () => {
    const firstLoad = ensureBrowserWebview({
      label: "browser-test",
      url: "https://google.com/",
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      visible: true,
      reloadKey: 0,
    });
    const close = closeBrowserWebview("browser-test");
    const secondLoad = ensureBrowserWebview({
      label: "browser-test",
      url: "https://google.com/",
      bounds: { x: 10, y: 20, width: 500, height: 350 },
      visible: true,
      reloadKey: 0,
    });

    await Promise.all([firstLoad, close, secondLoad]);

    expect(webviewMocks.MockWebview.instances).toHaveLength(2);
    expect(webviewMocks.MockWebview.instances[0]?.close).toHaveBeenCalledTimes(1);
    expect(webviewMocks.MockWebview.instances[1]?.show).toHaveBeenCalledTimes(1);
  });
});
