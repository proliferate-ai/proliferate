// @vitest-environment jsdom

import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigate, patchTargetSelection, showToast, dismissToast } = vi.hoisted(() => ({
  navigate: vi.fn(),
  patchTargetSelection: vi.fn(),
  showToast: vi.fn(),
  dismissToast: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

vi.mock("#product/hooks/home/ui/use-home-next-target-selection-state", () => ({
  useHomeNextTargetSelectionState: () => ({ patchTargetSelection }),
}));

vi.mock("#product/primitives/utils/show-toast", () => ({
  showToast,
  dismissToast,
}));

import {
  REPO_ADDED_TOAST_ID,
  useRepoAddedToast,
} from "./use-repo-added-toast";

function raise(input: Parameters<ReturnType<typeof useRepoAddedToast>>[0]) {
  const { result } = renderHook(() => useRepoAddedToast());
  act(() => {
    result.current(input);
  });
  return showToast.mock.calls.at(-1)?.[0];
}

describe("useRepoAddedToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("announces a local add as a receipt with both onward moves", () => {
    const input = raise({
      repoName: "proliferate",
      sourceRoot: "/Users/pablo/proliferate",
      source: "local",
    });

    expect(input).toMatchObject({
      id: REPO_ADDED_TOAST_ID,
      weight: "announcement",
      tone: "success",
      badge: "Added",
      title: "proliferate",
      description: "/Users/pablo/proliferate",
    });
    expect(input.secondary.label).toBe("Create workspace");
    expect(input.commit.label).toBe("Customize defaults");
  });

  it("names the cloud as the source instead of a path", () => {
    const input = raise({
      repoName: "proliferate",
      sourceRoot: "cloud:proliferate/proliferate",
      source: "cloud",
    });

    expect(input.description).toBe("Proliferate Cloud");
  });

  it("preselects the new repository on the home launcher and dismisses itself", () => {
    const input = raise({
      repoName: "proliferate",
      sourceRoot: "/Users/pablo/proliferate",
      source: "local",
    });

    act(() => {
      input.secondary.onClick();
    });

    expect(patchTargetSelection).toHaveBeenCalledWith({
      destination: "repository",
      repositorySelection: { kind: "repository", sourceRoot: "/Users/pablo/proliferate" },
      baseBranchOverride: null,
    });
    expect(navigate).toHaveBeenCalled();
    expect(dismissToast).toHaveBeenCalledWith(REPO_ADDED_TOAST_ID);
  });

  it("sends the commit action to that repository's settings", () => {
    const input = raise({
      repoName: "proliferate",
      sourceRoot: "/Users/pablo/proliferate",
      source: "local",
    });

    act(() => {
      input.commit.onClick();
    });

    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("/Users/pablo/proliferate")),
    );
    expect(dismissToast).toHaveBeenCalledWith(REPO_ADDED_TOAST_ID);
  });
});
