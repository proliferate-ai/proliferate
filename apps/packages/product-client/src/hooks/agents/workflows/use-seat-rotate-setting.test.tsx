// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSeatRotateSetting } from "#product/hooks/agents/workflows/use-seat-rotate-setting";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";

const putMutate = vi.hoisted(() => vi.fn());
const settingsData = vi.hoisted(() => ({
  current: undefined as Record<string, Record<string, unknown>> | undefined,
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentAuthHarnessSettings: () => ({ data: settingsData.current }),
  usePutAuthSelections: () => ({ mutate: putMutate, isPending: false }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (s: { show: () => void }) => unknown) =>
    selector({ show: vi.fn() }),
}));

/**
 * The rotate hook only reads `authReady`, `editorState`, and
 * `selectionsQuery` off the editor api — a partial fake keeps the test at the
 * seam under test (the unseeded-editor write gate) without standing up the
 * whole editor.
 */
function editorApi(overrides: {
  selectionsResolved: boolean;
  seatEnabled: boolean;
}): HarnessAuthEditorApi {
  return {
    authReady: true,
    editorState: {
      gatewayEnabled: false,
      seatEnabled: overrides.seatEnabled,
      rows: [],
    },
    selectionsQuery: {
      data: overrides.selectionsResolved ? [] : undefined,
    },
  } as unknown as HarnessAuthEditorApi;
}

describe("useSeatRotateSetting", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    settingsData.current = undefined;
  });

  it("reads as not loaded and performs NO PUT while the editor is unseeded — a click must not persist the default (empty) sources", () => {
    // The settings rider resolved, but the selections query (the editor's
    // seed) has not — exactly the window where editorState is still the
    // unseeded default and a PUT would send `sources: []`.
    settingsData.current = { claude: { rotate: true } };
    const { result } = renderHook(() =>
      useSeatRotateSetting(
        "claude",
        "local",
        editorApi({ selectionsResolved: false, seatEnabled: false }),
      ),
    );

    expect(result.current.loaded).toBe(false);
    act(() => {
      result.current.setRotate(false);
    });
    expect(putMutate).not.toHaveBeenCalled();
  });

  it("PUTs the seeded sources plus {...settings, rotate} once the selections resolved", () => {
    settingsData.current = { claude: { rotate: true, other: "kept" } };
    const { result } = renderHook(() =>
      useSeatRotateSetting(
        "claude",
        "local",
        editorApi({ selectionsResolved: true, seatEnabled: true }),
      ),
    );

    expect(result.current.loaded).toBe(true);
    act(() => {
      result.current.setRotate(false);
    });
    expect(putMutate).toHaveBeenCalledTimes(1);
    expect(putMutate.mock.calls[0]?.[0]).toEqual({
      harnessKind: "claude",
      surface: "local",
      body: {
        // The seeded editor state, not the unseeded default: the always-sent
        // gateway revision-marker row (off) plus the enabled seat pool row.
        sources: [
          { sourceKind: "gateway", enabled: false },
          { sourceKind: "seat", enabled: true },
        ],
        // Unrelated settings keys are preserved beside the flipped rotate.
        settings: { rotate: false, other: "kept" },
      },
    });
  });
});
