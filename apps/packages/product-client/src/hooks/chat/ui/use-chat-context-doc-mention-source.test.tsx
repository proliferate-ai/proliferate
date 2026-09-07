// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetFeatureFlagOverridesForTests,
  setFeatureFlagOverrideForTests,
} from "#product/config/feature-flags";
import { useChatContextDocMentionSource } from "#product/hooks/chat/ui/use-chat-context-doc-mention-source";

interface MockRun {
  id: string;
  status: string;
}

interface MockProjection {
  run: { definitionJson: string };
  docs: Array<{ id: string; runId: string; slug: string; filename: string }>;
}

const mocks = vi.hoisted(() => ({
  runs: [] as MockRun[],
  runsQueryEnabled: null as boolean | null,
  projectionsById: {} as Record<string, MockProjection>,
  requestedRunIds: [] as Array<string | null>,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useWorkflowRunsQuery: (_workspaceId: string | null, options: { enabled: boolean }) => {
    mocks.runsQueryEnabled = options.enabled;
    return {
      data: options.enabled ? { runs: mocks.runs } : undefined,
      isLoading: false,
    };
  },
  useWorkflowRunQuery: (runId: string | null, options: { enabled: boolean }) => {
    mocks.requestedRunIds.push(options.enabled ? runId : null);
    return {
      data: options.enabled && runId ? mocks.projectionsById[runId] : undefined,
      isLoading: false,
    };
  },
}));

vi.mock("#product/hooks/workspaces/derived/files/use-workspace-file-context", () => ({
  useWorkspaceFileContext: () => ({ materializedWorkspaceId: "workspace-1" }),
}));

function run(id: string, status = "completed"): MockRun {
  return { id, status };
}

function projection(
  runId: string,
  title: string | null,
  filenames: string[],
): MockProjection {
  return {
    run: { definitionJson: JSON.stringify(title === null ? {} : { title }) },
    docs: filenames.map((filename, index) => ({
      id: `${runId}-doc-${index}`,
      runId,
      slug: filename.replace(/\.md$/, ""),
      filename,
    })),
  };
}

describe("useChatContextDocMentionSource", () => {
  beforeEach(() => {
    setFeatureFlagOverrideForTests("chatContextDocMentions", true);
    mocks.runs = [];
    mocks.runsQueryEnabled = null;
    mocks.projectionsById = {};
    mocks.requestedRunIds = [];
  });

  afterEach(() => {
    cleanup();
    resetFeatureFlagOverridesForTests();
    vi.clearAllMocks();
  });

  it("yields nothing and disables every query while the flag is off", () => {
    resetFeatureFlagOverridesForTests();
    mocks.runs = [run("run-a")];
    mocks.projectionsById["run-a"] = projection("run-a", "Audit", ["01-plan.md"]);

    const { result } = renderHook(() => useChatContextDocMentionSource({
      open: true,
      query: "",
    }));

    expect(result.current.sourceEnabled).toBe(false);
    expect(result.current.candidates).toEqual([]);
    expect(mocks.runsQueryEnabled).toBe(false);
    expect(mocks.requestedRunIds.every((id) => id === null)).toBe(true);
  });

  it("disables every query while the menu is closed", () => {
    mocks.runs = [run("run-a")];

    const { result } = renderHook(() => useChatContextDocMentionSource({
      open: false,
      query: "",
    }));

    expect(result.current.candidates).toEqual([]);
    expect(mocks.runsQueryEnabled).toBe(false);
  });

  it("labels candidates with the run's definition title and keeps run order", () => {
    mocks.runs = [run("run-a"), run("run-b")];
    mocks.projectionsById["run-a"] = projection("run-a", "Release checklist", ["01-plan.md"]);
    mocks.projectionsById["run-b"] = projection("run-b", null, ["02-findings.md"]);

    const { result } = renderHook(() => useChatContextDocMentionSource({
      open: true,
      query: "",
    }));

    expect(result.current.candidates).toEqual([
      {
        docId: "run-a-doc-0",
        runId: "run-a",
        slug: "01-plan",
        filename: "01-plan.md",
        runLabel: "Release checklist",
      },
      {
        docId: "run-b-doc-0",
        runId: "run-b",
        slug: "02-findings",
        filename: "02-findings.md",
        runLabel: null,
      },
    ]);
  });

  it("reads docs from at most four runs, active runs first", () => {
    mocks.runs = [
      run("run-1", "completed"),
      run("run-2", "completed"),
      run("run-3", "running"),
      run("run-4", "completed"),
      run("run-5", "awaiting_human"),
      run("run-6", "completed"),
    ];
    for (const { id } of mocks.runs) {
      mocks.projectionsById[id] = projection(id, null, [`${id}.md`]);
    }

    const { result } = renderHook(() => useChatContextDocMentionSource({
      open: true,
      query: "",
    }));

    // Active runs (3, 5) lead in list order, then the newest settled (1, 2);
    // runs 4 and 6 fall past the cap and are never fetched.
    expect(mocks.requestedRunIds.filter(Boolean)).toEqual([
      "run-3", "run-5", "run-1", "run-2",
    ]);
    expect(result.current.candidates.map((candidate) => candidate.runId)).toEqual([
      "run-3", "run-5", "run-1", "run-2",
    ]);
  });

  it("narrows candidates by the typed query", () => {
    mocks.runs = [run("run-a")];
    mocks.projectionsById["run-a"] = projection("run-a", "Audit", [
      "01-plan.md",
      "02-findings.md",
    ]);

    const { result } = renderHook(() => useChatContextDocMentionSource({
      open: true,
      query: "find",
    }));

    expect(result.current.candidates.map((candidate) => candidate.filename))
      .toEqual(["02-findings.md"]);
  });
});
