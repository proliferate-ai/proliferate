// @vitest-environment jsdom

import type { PropsWithChildren, ReactElement } from "react";
import {
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
} from "@testing-library/react";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import {
  parsedCommandItem,
  toolItem,
} from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";
import { CollapsedActions } from "#product/components/workspace/chat/tool-calls/CollapsedActions";

const webTestHost = { desktop: null } as ProductHost;

function WebProductHostWrapper({ children }: PropsWithChildren) {
  return <ProductHostProvider host={webTestHost}>{children}</ProductHostProvider>;
}

function render(ui: ReactElement) {
  return testingRender(ui, { wrapper: WebProductHostWrapper });
}

const {
  openPrimaryMock,
  fileReferenceActionsCalls,
  fileReferenceActionState,
} = vi.hoisted(() => ({
  openPrimaryMock: vi.fn(),
  fileReferenceActionsCalls: [] as Array<{ rawPath: string; workspacePath?: string | null }>,
  fileReferenceActionState: { canOpenPrimary: true },
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: (args: { rawPath: string; workspacePath?: string | null }) => {
    fileReferenceActionsCalls.push(args);
    return {
      reference: {
        rawPath: args.rawPath,
        path: args.rawPath,
        line: null,
        column: null,
        absolutePath: `/repo/${args.rawPath}`,
        workspacePath: args.rawPath,
      },
      openTargets: [],
      defaultOpenTarget: null,
      pathKind: "file",
      pathKindPending: false,
      canOpenInSidebar: true,
      canOpenExternal: true,
      canOpenPrimary: fileReferenceActionState.canOpenPrimary,
      canReveal: true,
      primaryUnavailableReason: null,
      copyPath: vi.fn(),
      openInSidebar: vi.fn(),
      openDefault: vi.fn(),
      openPrimary: openPrimaryMock,
      openWithTarget: vi.fn(),
      reveal: vi.fn(),
    };
  },
}));

afterEach(() => {
  cleanup();
  openPrimaryMock.mockClear();
  fileReferenceActionsCalls.length = 0;
  fileReferenceActionState.canOpenPrimary = true;
});

describe("CollapsedActionRows read rows", () => {

  it("renders read ledger rows as blue, clickable file references", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read"),
    };

    render(
      <CollapsedActions
        itemIds={["read"]}
        transcript={transcript}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read files/i }));

    const badge = screen.getByText("Read").parentElement
      ?.querySelector("[data-file-reference-badge='inline']");
    const readRow = badge?.closest("[title]");
    expect(badge?.textContent).toContain("read.ts");
    expect(badge?.tagName).toBe("BUTTON");
    expect(badge?.getAttribute("aria-disabled")).toBeNull();
    expect(badge?.className).toContain("text-link-foreground");
    expect(badge?.className).toContain("hover:text-link-foreground");
    expect(badge?.className).not.toContain("!text-inherit");
    expect(badge?.className).not.toContain("hover:!text-inherit");
    expect(badge?.className).toContain("decoration-dotted");
    expect(badge?.className).toContain("[&>span:first-child]:hidden");
    expect(readRow?.getAttribute("title")).toContain("read.ts");

    fireEvent.click(badge as Element);
    expect(openPrimaryMock).toHaveBeenCalledTimes(1);
    expect(fileReferenceActionsCalls.find((call) => call.rawPath === "read.ts")?.workspacePath)
      .toBe("read.ts");
  });

  it("renders a read target with no primary action as plain text", () => {
    fileReferenceActionState.canOpenPrimary = false;
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read"),
    };

    render(
      <CollapsedActions
        itemIds={["read"]}
        transcript={transcript}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read files/i }));

    const reference = screen.getByText("read.ts")
      .closest("[data-file-reference-badge='inline']");
    expect(reference?.tagName).toBe("SPAN");
    expect(reference?.getAttribute("aria-disabled")).toBeNull();
    expect(reference?.className).not.toContain("text-link-foreground");
    expect(reference?.className).not.toContain("cursor-not-allowed");
    expect(reference?.className).toContain("!no-underline");
  });

  it("opens raw-input fallback reads through workspace-root inference", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: {
        ...toolItem("read", "turn-1", 1, "file_read"),
        contentParts: [],
        rawInput: { file_path: "src/deep/notes.md" },
      },
    };

    render(
      <CollapsedActions
        itemIds={["read"]}
        transcript={transcript}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read/i }));

    const call = fileReferenceActionsCalls.find((entry) => entry.rawPath === "src/deep/notes.md");
    expect(call).toBeTruthy();
    // undefined (not null) so the resolver may infer a workspace-relative path
    // and the click can open the in-app viewer.
    expect(call?.workspacePath).toBeUndefined();

    fireEvent.click(screen.getByText("notes.md"));
    expect(openPrimaryMock).toHaveBeenCalledTimes(1);
  });

  it("opens parsed shell reads through workspace-root inference", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      parsed: parsedCommandItem("parsed", "turn-1", 1, [
        { type: "read", cmd: "cat src/lib/util.ts", path: "src/lib/util.ts", name: "util.ts" },
      ], "completed"),
    };

    render(
      <CollapsedActions
        itemIds={["parsed"]}
        transcript={transcript}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read/i }));

    const call = fileReferenceActionsCalls.find((entry) => entry.rawPath === "src/lib/util.ts");
    expect(call).toBeTruthy();
    expect(call?.workspacePath).toBeUndefined();

    fireEvent.click(screen.getByText("util.ts"));
    expect(openPrimaryMock).toHaveBeenCalledTimes(1);
  });

  it("infers a relative structured read when nullable workspace metadata is missing", () => {
    const transcript = createTranscriptState("session-1");
    const read = toolItem("read", "turn-1", 1, "file_read");
    const part = read.contentParts[0];
    if (part?.type === "file_read") {
      part.path = "src/legacy/read.ts";
      part.basename = "read.ts";
      part.workspacePath = null;
    }
    transcript.itemsById = { read };

    render(
      <CollapsedActions
        itemIds={["read"]}
        transcript={transcript}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read/i }));

    const call = fileReferenceActionsCalls.find(
      (entry) => entry.rawPath === "src/legacy/read.ts",
    );
    expect(call?.workspacePath).toBeUndefined();

    fireEvent.click(screen.getByText("read.ts"));
    expect(openPrimaryMock).toHaveBeenCalledTimes(1);
  });

  it("infers classification for structured reads without workspace metadata", () => {
    const transcript = createTranscriptState("session-1");
    const read = toolItem("read", "turn-1", 1, "file_read");
    const part = read.contentParts[0];
    if (part?.type === "file_read") {
      part.path = "/etc/hosts";
      part.basename = "hosts";
      part.workspacePath = null;
    }
    transcript.itemsById = { read };

    render(
      <CollapsedActions
        itemIds={["read"]}
        transcript={transcript}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read/i }));

    const call = fileReferenceActionsCalls.find((entry) => entry.rawPath === "/etc/hosts");
    expect(call).toBeTruthy();
    expect(call?.workspacePath).toBeUndefined();
  });
});
