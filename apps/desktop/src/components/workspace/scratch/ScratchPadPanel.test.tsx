// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScratchPadPanel } from "@/components/workspace/scratch/ScratchPadPanel";

const scratchQueryMocks = vi.hoisted(() => ({
  record: {
    content: "",
    updatedAtMs: 1,
  } as { content: string; updatedAtMs: number | null } | undefined,
  isLoading: false,
  writeScratchPad: vi.fn(async () => ({ updatedAtMs: 1 })),
  setScratchPadCache: vi.fn(),
}));

const hostMocks = vi.hoisted(() => ({
  writeText: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/access/tauri/workspace-scratch/use-workspace-scratch-pad", () => ({
  useWorkspaceScratchPad: () => ({
    data: scratchQueryMocks.record,
    isLoading: scratchQueryMocks.isLoading,
  }),
}));

vi.mock("@/hooks/access/tauri/workspace-scratch/use-workspace-scratch-pad-mutations", () => ({
  useWorkspaceScratchPadMutations: () => ({
    writeScratchPad: scratchQueryMocks.writeScratchPad,
    writeScratchPadState: {
      isPending: false,
      isError: false,
    },
    setScratchPadCache: scratchQueryMocks.setScratchPadCache,
  }),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    clipboard: { writeText: hostMocks.writeText },
  }),
}));

vi.mock("@/components/workspace/scratch/ScratchCodeMirrorEditor", async () => {
  const React = await import("react");
  const ScratchCodeMirrorEditor = React.forwardRef(({
    value,
    placeholder,
    disabled,
    onChange,
    onBlur,
  }: {
    value: string;
    placeholder: string;
    disabled: boolean;
    onChange: (value: string) => void;
    onBlur: () => void;
  }, ref) => {
    React.useImperativeHandle(ref, () => ({
      insertChecklistItem: () => {
        onChange(value ? `${value}\n- [ ] ` : "- [ ] ");
        return true;
      },
    }), [onChange, value]);

    return (
      <textarea
        aria-label="Scratch"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  });

  return {
    ScratchCodeMirrorEditor,
  };
});

beforeEach(() => {
  scratchQueryMocks.record = {
    content: "",
    updatedAtMs: 1,
  };
  scratchQueryMocks.writeScratchPad = vi.fn(async () => ({ updatedAtMs: 1 }));
  scratchQueryMocks.setScratchPadCache = vi.fn();
  scratchQueryMocks.isLoading = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ScratchPadPanel", () => {

  it("renders loaded scratch content and debounces writes", async () => {
    vi.useFakeTimers();
    scratchQueryMocks.record = {
      content: "- [ ] keep this",
      updatedAtMs: 1,
    };
    render(<ScratchPadPanel workspaceKey="workspace-1" />);

    const editor = screen.getByPlaceholderText(/Write notes here/) as HTMLTextAreaElement;
    expect(editor.value).toBe("- [ ] keep this");

    fireEvent.change(editor, { target: { value: "- [ ] updated" } });
    expect(scratchQueryMocks.writeScratchPad).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(scratchQueryMocks.writeScratchPad).toHaveBeenCalledWith(
      "- [ ] updated",
      "workspace-1",
    );
    expect(scratchQueryMocks.setScratchPadCache).toHaveBeenCalledWith(
      "- [ ] updated",
      1,
      "workspace-1",
    );
  });

  it("keeps newer local edits when stale cache data arrives", () => {
    scratchQueryMocks.record = {
      content: "",
      updatedAtMs: 1,
    };
    const { rerender } = render(<ScratchPadPanel workspaceKey="workspace-1" />);

    const editor = screen.getByPlaceholderText(/Write notes here/) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "newer local draft" } });

    scratchQueryMocks.record = {
      content: "older saved draft",
      updatedAtMs: 2,
    };
    rerender(<ScratchPadPanel workspaceKey="workspace-1" />);

    expect(editor.value).toBe("newer local draft");
  });

  it("serializes saves so newer edits are written after stale in-flight writes", async () => {
    vi.useFakeTimers();
    scratchQueryMocks.record = {
      content: "",
      updatedAtMs: 1,
    };
    const resolvers: Array<(result: { updatedAtMs: number }) => void> = [];
    scratchQueryMocks.writeScratchPad = vi.fn(
      () => new Promise<{ updatedAtMs: number }>((resolve) => {
        resolvers.push(resolve);
      }),
    );
    render(<ScratchPadPanel workspaceKey="workspace-1" />);

    const editor = screen.getByPlaceholderText(/Write notes here/) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "first draft" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(scratchQueryMocks.writeScratchPad).toHaveBeenCalledWith(
      "first draft",
      "workspace-1",
    );

    fireEvent.change(editor, { target: { value: "second draft" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(scratchQueryMocks.writeScratchPad).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]?.({ updatedAtMs: 10 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(scratchQueryMocks.writeScratchPad).toHaveBeenCalledTimes(2);
    expect(scratchQueryMocks.writeScratchPad).toHaveBeenLastCalledWith(
      "second draft",
      "workspace-1",
    );
    expect(scratchQueryMocks.setScratchPadCache).not.toHaveBeenCalledWith(
      "first draft",
      10,
      "workspace-1",
    );

    await act(async () => {
      resolvers[1]?.({ updatedAtMs: 11 });
      await Promise.resolve();
    });

    expect(scratchQueryMocks.setScratchPadCache).toHaveBeenCalledWith(
      "second draft",
      11,
      "workspace-1",
    );
  });

  it("clears visible scratch content while a new workspace read is loading", () => {
    scratchQueryMocks.record = {
      content: "workspace one note",
      updatedAtMs: 1,
    };
    const { rerender } = render(<ScratchPadPanel workspaceKey="workspace-1" />);

    expect((screen.getByPlaceholderText(/Write notes here/) as HTMLTextAreaElement).value)
      .toBe("workspace one note");

    scratchQueryMocks.record = undefined;
    scratchQueryMocks.isLoading = true;
    rerender(<ScratchPadPanel workspaceKey="workspace-2" />);

    expect((screen.getByPlaceholderText(/Loading scratch/) as HTMLTextAreaElement).value)
      .toBe("");
  });

  it("inserts checklist items and clears completed tasks from the options menu", async () => {
    scratchQueryMocks.record = {
      content: "- [ ] open\n- [x] done\n",
      updatedAtMs: 1,
    };
    render(<ScratchPadPanel workspaceKey="workspace-1" />);

    const editor = screen.getByPlaceholderText(/Write notes here/) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Scratch options" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear completed" }));

    expect(editor.value).toBe("- [ ] open\n");

    fireEvent.click(screen.getByRole("button", { name: "Scratch options" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert checklist item" }));

    expect(editor.value).toContain("- [ ] ");
  });

  it("clears completed literal checklist items from the options menu", async () => {
    scratchQueryMocks.record = {
      content: "☐ open\n☑ done\n",
      updatedAtMs: 1,
    };
    render(<ScratchPadPanel workspaceKey="workspace-1" />);

    const editor = screen.getByPlaceholderText(/Write notes here/) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Scratch options" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear completed" }));

    expect(editor.value).toBe("☐ open\n");
  });

  it("copies scratch content through ProductHost clipboard", async () => {
    scratchQueryMocks.record = {
      content: "durable note",
      updatedAtMs: 1,
    };
    render(<ScratchPadPanel workspaceKey="workspace-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Scratch options" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy content" }));

    await waitFor(() => expect(hostMocks.writeText).toHaveBeenCalledWith("durable note"));
  });
});
