// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
} from "@/lib/domain/home/home-next-launch";
import { useHomeNextComposerState } from "./use-home-next-composer-state";

const launchMock = vi.fn();

vi.mock("@/hooks/home/workflows/use-home-next-launch", () => ({
  useHomeNextLaunch: () => ({ isLaunching: false, launch: launchMock }),
}));

vi.mock("@/stores/home/home-draft-handoff-store", () => ({
  useHomeDraftHandoffStore: (selector: (state: unknown) => unknown) =>
    selector({ draftText: null, clearDraftText: vi.fn() }),
}));

const modelSelection: HomeNextModelSelection = {
  kind: "codex",
  modelId: "gpt-5.4",
} as HomeNextModelSelection;

const launchTarget: HomeLaunchTarget = {
  kind: "local",
  sourceRoot: "/repo",
} as HomeLaunchTarget;

function renderComposer() {
  return renderHook(() =>
    useHomeNextComposerState({
      targetDisabledReason: null,
      modelAvailabilityState: "launchable",
      canLaunchTarget: true,
      modelSelection,
      modeId: null,
      launchControlValues: {},
      launchTarget,
    }),
  );
}

describe("useHomeNextComposerState (navigate-first)", () => {
  beforeEach(() => {
    launchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not expose a home-side submitted preview", () => {
    const { result } = renderComposer();
    expect("submittedPreview" in result.current).toBe(false);
  });

  it("clears the draft and launches without painting an optimistic preview on home", async () => {
    launchMock.mockResolvedValue(true);
    const { result } = renderComposer();

    act(() => {
      result.current.setDraft("hello world");
    });
    expect(result.current.canSubmit).toBe(true);

    await act(async () => {
      await result.current.submit();
    });

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "hello world", target: launchTarget }),
    );
    // The draft is cleared; the destination pending session owns the preview.
    expect(result.current.draft).toBe("");
  });

  it("restores the draft when the launch fails", async () => {
    launchMock.mockResolvedValue(false);
    const { result } = renderComposer();

    act(() => {
      result.current.setDraft("retry me");
    });

    await act(async () => {
      await result.current.submit();
    });

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(result.current.draft).toBe("retry me");
  });
});
