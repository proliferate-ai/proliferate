// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_FILE_MENTION_SEARCH_LIMIT } from "#product/config/chat";
import { useChatFileMentionMenu } from "#product/hooks/chat/ui/use-chat-file-mention-menu";

const mocks = vi.hoisted(() => ({
  searchArgs: null as Record<string, unknown> | null,
  searchDebouncedQuery: "cmp",
  searchIsPlaceholderData: false,
  searchResults: [] as Array<{ path: string; name: string }>,
}));

vi.mock("#product/hooks/workspaces/derived/files/use-workspace-file-context", () => ({
  useWorkspaceFileContext: () => ({ materializedWorkspaceId: "workspace-1" }),
}));

vi.mock("#product/hooks/workspaces/facade/use-selected-cloud-runtime-state", () => ({
  useSelectedCloudRuntimeState: () => ({ state: null }),
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

describe("useChatFileMentionMenu", () => {
  beforeEach(() => {
    mocks.searchArgs = null;
    mocks.searchDebouncedQuery = "cmp";
    mocks.searchIsPlaceholderData = false;
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
    expect(result.current.results).toHaveLength(200);
    expect(result.current.results[8]?.path).toBe("src/composer-8.ts");
    expect(result.current.results[199]?.path).toBe("src/composer-199.ts");
  });

  it("keeps prior-query placeholder rows out of the selectable menu", () => {
    mocks.searchIsPlaceholderData = true;

    const { result } = renderHook(() => useChatFileMentionMenu({
      open: true,
      query: "cmp",
      onSelect: vi.fn(),
    }));

    expect(result.current.results).toEqual([]);
    expect(result.current.isPending).toBe(true);
  });

  it("keeps rows hidden while the debounce still represents an older token", () => {
    mocks.searchDebouncedQuery = "old-query";

    const { result } = renderHook(() => useChatFileMentionMenu({
      open: true,
      query: "cmp",
      onSelect: vi.fn(),
    }));

    expect(result.current.results).toEqual([]);
    expect(result.current.isPending).toBe(true);
  });
});
