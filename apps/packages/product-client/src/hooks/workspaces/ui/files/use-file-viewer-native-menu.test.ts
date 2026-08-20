// @vitest-environment jsdom
//
// Proves native/DOM-fallback menu parity per the 02B open-in/options-menu
// contract: same applicable items, same order, identical exact verb form.
// `buildFileViewerNativeMenuItems` is the native-menu source of truth;
// `FileViewerMenuBody` (browser/test fallback) is exercised through
// `renderMenuBodyLabels` below and compared item-for-item.

import { createElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFileViewerNativeMenuItems,
  type FileViewerNativeMenuActions,
} from "#product/hooks/workspaces/ui/files/use-file-viewer-native-menu";
import { FileViewerMenuBody } from "#product/components/workspace/files/viewer/FileViewerToolbar";

function baseActions(overrides: Partial<FileViewerNativeMenuActions> = {}): FileViewerNativeMenuActions {
  return {
    canCopyContent: true,
    canRenderRichPreview: true,
    richPreviewEnabled: false,
    wordWrap: false,
    onCopyContent: vi.fn(),
    onCopyPath: vi.fn(),
    onToggleWordWrap: vi.fn(),
    onToggleRichPreview: vi.fn(),
    ...overrides,
  };
}

/** Applicable, ordered {label, enabled} pairs from the DOM fallback. */
function renderMenuBodyLabels(actions: FileViewerNativeMenuActions) {
  const { container } = render(
    createElement(FileViewerMenuBody, { close: vi.fn(), ...actions }),
  );
  const buttons = Array.from(container.querySelectorAll("button"));
  return buttons.map((button) => ({
    label: button.textContent?.trim().replace(/(On|Off)$/, "").trim() ?? "",
    enabled: !button.disabled,
  }));
}

/** Applicable, ordered {label, enabled} pairs from the native menu builder. */
function nativeLabels(actions: FileViewerNativeMenuActions) {
  return buildFileViewerNativeMenuItems(actions)
    .filter((item): item is Extract<typeof item, { id: string }> => "id" in item)
    .map((item) => ({ label: item.label, enabled: item.enabled ?? true }));
}

afterEach(() => {
  cleanup();
});

describe("file viewer options menu parity", () => {
  it("exposes identical items, order, and verb form by default", () => {
    const actions = baseActions();
    expect(nativeLabels(actions)).toEqual([
      { label: "Copy content", enabled: true },
      { label: "Copy path", enabled: true },
      { label: "Enable word wrap", enabled: true },
      { label: "Enable rich preview", enabled: true },
    ]);
    expect(renderMenuBodyLabels(actions)).toEqual(nativeLabels(actions));
  });

  it("flips to the Disable verb once a toggle is on, in both menus", () => {
    const actions = baseActions({ wordWrap: true, richPreviewEnabled: true });
    expect(nativeLabels(actions)).toEqual([
      { label: "Copy content", enabled: true },
      { label: "Copy path", enabled: true },
      { label: "Disable word wrap", enabled: true },
      { label: "Disable rich preview", enabled: true },
    ]);
    expect(renderMenuBodyLabels(actions)).toEqual(nativeLabels(actions));
  });

  it("omits rich preview for fileDiff in both menus, never as stale disabled state", () => {
    const actions = baseActions({ canRenderRichPreview: false });
    const native = nativeLabels(actions);
    const fallback = renderMenuBodyLabels(actions);
    expect(native.some((item) => item.label.includes("rich preview"))).toBe(false);
    expect(fallback.some((item) => item.label.includes("rich preview"))).toBe(false);
    expect(fallback).toEqual(native);
  });

  it("disables copy content identically when content is not readable, in both menus", () => {
    const actions = baseActions({ canCopyContent: false });
    const native = nativeLabels(actions);
    expect(native[0]).toEqual({ label: "Copy content", enabled: false });
    expect(renderMenuBodyLabels(actions)).toEqual(native);
  });

  it("keeps copy path always applicable and calls the 01D copyCurrentPath binding, not a DOM path", () => {
    const onCopyPath = vi.fn();
    const actions = baseActions({ onCopyPath });
    render(createElement(FileViewerMenuBody, { close: vi.fn(), ...actions }));
    screen.getByText("Copy path").click();
    expect(onCopyPath).toHaveBeenCalledWith();
    expect(onCopyPath).toHaveBeenCalledTimes(1);
  });
});
