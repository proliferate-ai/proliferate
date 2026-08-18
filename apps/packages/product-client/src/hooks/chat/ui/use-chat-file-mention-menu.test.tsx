// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_FILE_MENTION_SEARCH_LIMIT } from "#product/config/chat";
import { useChatFileMentionMenu } from "#product/hooks/chat/ui/use-chat-file-mention-menu";
import type { ContextDocMentionCandidate } from "#product/lib/domain/chat/composer/context-doc-mention";

const mocks = vi.hoisted(() => ({
  searchArgs: null as Record<string, unknown> | null,
  searchDebouncedQuery: "cmp",
  searchIsPlaceholderData: false,
  searchResults: [] as Array<{ path: string; name: string }>,
  contextDocCandidates: [] as ContextDocMentionCandidate[],
}));

vi.mock("#product/hooks/workspaces/derived/files/use-workspace-file-context", () => ({
  useWorkspaceFileContext: () => ({ materializedWorkspaceId: "workspace-1" }),
}));

vi.mock("#product/hooks/workspaces/facade/use-selected-cloud-runtime-state", () => ({
  useSelectedCloudRuntimeState: () => ({ state: null }),
}));

vi.mock("#product/hooks/chat/ui/use-chat-context-doc-mention-source", () => ({
  useChatContextDocMentionSource: () => ({
    candidates: mocks.contextDocCandidates,
    sourceEnabled: mocks.contextDocCandidates.length > 0,
    isLoading: false,
  }),
}));

vi.mock("#product/hooks/workspaces/ui/files/use-workspace-file-search", () => ({
  useWorkspaceFileSearch: (args: Record<string, unknown>) => {
    mocks.searchArgs = args;
    return {
      query: "cmp",
      debouncedQuery: mocks.searchDebouncedQuery,
      searchEnabled: true,
      isLoading: false,
      isError: false,
      isPlaceholderData: mocks.searchIsPlaceholderData,
      results: mocks.searchResults,
    };
  },
}));

function docCandidate(docId: string, filename: string): ContextDocMentionCandidate {
  return { docId, runId: "run-a", slug: filename.replace(/\.md$/, ""), filename, runLabel: null };
}

describe("useChatFileMentionMenu", () => {
  beforeEach(() => {
    mocks.searchArgs = null;
    mocks.searchDebouncedQuery = "cmp";
    mocks.searchIsPlaceholderData = false;
    mocks.contextDocCandidates = [];
    mocks.searchResults = Array.from({ length: 200 }, (_, index) => ({
      path: `src/composer-${index}.ts`,
      name: `composer-${index}.ts`,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps the runtime's full bounded result page instead of stopping at eight rows", () => {
    const { result } = renderHook(() => useChatFileMentionMenu({
      open: true,
      query: "cmp",
      onSelect: vi.fn(),
    }));

    expect(mocks.searchArgs).toMatchObject({
      limit: 200,
      query: "cmp",
      workspaceId: "workspace-1",
    });
    expect(CHAT_FILE_MENTION_SEARCH_LIMIT).toBe(200);
    expect(result.current.items).toHaveLength(200);
    expect(result.current.items[8]).toMatchObject({
      kind: "file",
      file: { path: "src/composer-8.ts" },
    });
    expect(result.current.items[199]).toMatchObject({
      kind: "file",
      file: { path: "src/composer-199.ts" },
    });
  });

  it("keeps prior-query placeholder rows out of the selectable menu", () => {
    mocks.searchIsPlaceholderData = true;

    const { result } = renderHook(() => useChatFileMentionMenu({
      open: true,
      query: "cmp",
      onSelect: vi.fn(),
    }));

    expect(result.current.items).toEqual([]);
    expect(result.current.isPending).toBe(true);
  });

  it("keeps rows hidden while the debounce still represents an older token", () => {
    mocks.searchDebouncedQuery = "old-query";

    const { result } = renderHook(() => useChatFileMentionMenu({
      open: true,
      query: "cmp",
      onSelect: vi.fn(),
    }));

    expect(result.current.items).toEqual([]);
    expect(result.current.isPending).toBe(true);
  });

  it("leads the merged list with context docs and selects across the flat index", () => {
    mocks.contextDocCandidates = [
      docCandidate("doc-1", "01-plan.md"),
      docCandidate("doc-2", "02-findings.md"),
    ];
    mocks.searchResults = [{ path: "src/plan.ts", name: "plan.ts" }];
    const onSelect = vi.fn();

    const { result } = renderHook(() => useChatFileMentionMenu({
      open: true,
      query: "cmp",
      onSelect,
    }));

    expect(result.current.items.map((item) => item.kind))
      .toEqual(["contextDoc", "contextDoc", "file"]);
    result.current.selectHighlighted();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      kind: "contextDoc",
      doc: expect.objectContaining({ docId: "doc-1" }),
    }));
  });

  it("still offers doc rows while file results wait on the debounce", () => {
    mocks.searchDebouncedQuery = "old-query";
    mocks.contextDocCandidates = [
      docCandidate("doc-1", "01-plan.md"),
    ];

    const { result } = renderHook(() => useChatFileMentionMenu({
      open: true,
      query: "cmp",
      onSelect: vi.fn(),
    }));

    expect(result.current.items.map((item) => item.kind)).toEqual(["contextDoc"]);
  });
});
