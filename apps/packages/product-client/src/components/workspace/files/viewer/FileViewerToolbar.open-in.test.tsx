// @vitest-environment jsdom
//
// Open-in split action per the 02B open-in contract: compact icon-only
// SplitButton (showLabel=false) with the default target's registered icon
// and exact accessible label `Open in <defaultOpenTarget.label>`, an
// adjacent OpenTargetMenu listing `openTargets` once each in order, fail-
// closed zero-render when ineligible, and openInRevision-keyed remount.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";
import { FileViewerToolbar } from "#product/components/workspace/files/viewer/FileViewerToolbar";

vi.mock("#product/hooks/workspaces/ui/files/use-file-viewer-native-menu", () => ({
  useFileViewerNativeMenu: () => ({ showNativeMenu: vi.fn(async () => true) }),
}));

const vsCode: OpenTarget = { id: "vscode", label: "VS Code", kind: "app" };
const cursor: OpenTarget = { id: "cursor", label: "Cursor", kind: "app" };

const noop = () => {};

function renderToolbar(overrides: Partial<Parameters<typeof FileViewerToolbar>[0]> = {}) {
  return render(
    <FileViewerToolbar
      filePath="src/index.tsx"
      filesAvailable
      onRevealFilesPath={noop}
      canRenderRichPreview={false}
      richPreviewEnabled={false}
      wordWrap={false}
      canCopyContent
      canFindInFile={false}
      onToggleWordWrap={noop}
      onToggleRichPreview={noop}
      onCopyContent={noop}
      onCopyPath={noop}
      openInEligible={false}
      openInDefaultTarget={null}
      openInTargets={[]}
      onOpenDefault={noop}
      onOpenWithTarget={noop}
      openInRevision={0}
      openInFailed={false}
      onOpenContentSearch={noop}
      toggleLabel="Show files"
      toggleActive={false}
      toggleHelp={undefined}
      onToggleFiles={noop}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("FileViewerToolbar open-in split action", () => {
  it("renders the compact icon-only control with the exact accessible label for a local-direct target", () => {
    renderToolbar({
      openInEligible: true,
      openInDefaultTarget: vsCode,
      openInTargets: [vsCode, cursor],
    });

    const primary = screen.getByRole("button", { name: "Open in VS Code" });
    expect(primary.getAttribute("title")).toBe("Open in VS Code");
    // Icon-only: the label text stays screen-reader only, never visible.
    expect(within(primary).getByText("Open in VS Code").className).toContain("sr-only");
    expect(screen.getByRole("button", { name: "Choose Open in VS Code" })).toBeTruthy();
  });

  it("renders identically for a local-companion resolved default target", () => {
    const companionTarget: OpenTarget = { id: "vscode", label: "VS Code (companion)", kind: "app" };
    renderToolbar({
      openInEligible: true,
      openInDefaultTarget: companionTarget,
      openInTargets: [companionTarget],
    });

    expect(screen.getByRole("button", { name: "Open in VS Code (companion)" })).toBeTruthy();
  });

  it("lists openTargets once each, in 01D order, and calls openWithTarget(targetId) on selection", () => {
    const onOpenWithTarget = vi.fn();
    renderToolbar({
      openInEligible: true,
      openInDefaultTarget: vsCode,
      openInTargets: [vsCode, cursor],
      onOpenWithTarget,
    });

    fireEvent.click(screen.getByRole("button", { name: "Choose Open in VS Code" }));
    const items = [
      screen.getByRole("button", { name: "VS Code" }),
      screen.getByRole("button", { name: "Cursor" }),
    ];
    expect(items.map((item) => item.textContent?.trim())).toEqual(["VS Code", "Cursor"]);

    fireEvent.click(screen.getByRole("button", { name: "Cursor" }));
    expect(onOpenWithTarget).toHaveBeenCalledTimes(1);
    expect(onOpenWithTarget).toHaveBeenCalledWith(cursor);
  });

  it("calls onOpenDefault with no path argument when the primary action is clicked", () => {
    const onOpenDefault = vi.fn();
    renderToolbar({
      openInEligible: true,
      openInDefaultTarget: vsCode,
      openInTargets: [vsCode],
      onOpenDefault,
    });

    fireEvent.click(screen.getByRole("button", { name: "Open in VS Code" }));
    expect(onOpenDefault).toHaveBeenCalledTimes(1);
    // No caller path argument: whatever the DOM click handler forwards, it is
    // never a string path.
    for (const call of onOpenDefault.mock.calls) {
      for (const arg of call) {
        expect(typeof arg).not.toBe("string");
      }
    }
  });

  it("never synthesizes a Finder or copy pseudo-target in the menu", () => {
    renderToolbar({
      openInEligible: true,
      openInDefaultTarget: vsCode,
      openInTargets: [vsCode],
    });

    fireEvent.click(screen.getByRole("button", { name: "Choose Open in VS Code" }));
    expect(screen.queryByText(/finder/i)).toBeNull();
    expect(screen.queryByText(/^copy/i)).toBeNull();
  });

  it("renders no open-in control and offers no target menu when ineligible", () => {
    renderToolbar({ openInEligible: false, openInDefaultTarget: null, openInTargets: [] });

    expect(screen.queryByText(/^Open in /)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Choose Open in/ })).toBeNull();
  });

  it("remounts the split-button subtree closed when openInRevision changes, per the fail-closed contract", () => {
    const { rerender } = renderToolbar({
      openInEligible: true,
      openInDefaultTarget: vsCode,
      openInTargets: [vsCode, cursor],
      openInRevision: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "Choose Open in VS Code" }));
    expect(screen.getByRole("button", { name: "VS Code" })).toBeTruthy();

    rerender(
      <FileViewerToolbar
        filePath="src/index.tsx"
        filesAvailable
        onRevealFilesPath={noop}
        canRenderRichPreview={false}
        richPreviewEnabled={false}
        wordWrap={false}
        canCopyContent
        canFindInFile={false}
        onToggleWordWrap={noop}
        onToggleRichPreview={noop}
        onCopyContent={noop}
        onCopyPath={noop}
        openInEligible
        openInDefaultTarget={vsCode}
        openInTargets={[vsCode, cursor]}
        onOpenDefault={noop}
        onOpenWithTarget={noop}
        openInRevision={2}
        openInFailed={false}
        onOpenContentSearch={noop}
        toggleLabel="Show files"
        toggleActive={false}
        toggleHelp={undefined}
        onToggleFiles={noop}
      />,
    );

    expect(screen.queryByRole("button", { name: "VS Code" })).toBeNull();
  });

  it("surfaces bounded retryable copy on native open failure without leaking raw errors or paths", () => {
    renderToolbar({
      openInEligible: true,
      openInDefaultTarget: vsCode,
      openInTargets: [vsCode],
      openInFailed: true,
    });

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Could not open the file. Click to retry.");
    expect(status.textContent).not.toMatch(/\/|Error|error:/);
  });
});
