// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTestProductHost, productHostWrapper } from "#product/test/product-host-test-utils";
import {
  cachedHomeNextTargetSelectionForTests,
  resetHomeNextTargetSelectionForTests,
  useHomeNextTargetSelectionState,
} from "#product/hooks/home/ui/use-home-next-target-selection-state";

beforeEach(() => {
  resetHomeNextTargetSelectionForTests();
});

afterEach(() => {
  cleanup();
  resetHomeNextTargetSelectionForTests();
});

// FM8/Q3 (PRO-10): a persisted `repoLaunchKind: "cloud"` selection from a
// pre-cull build must not survive on Desktop. This must be fixed at the
// selection source (normalizeDesktopTargetAvailability), not just at
// display time in HomeTargetPicker, so every downstream reader (derived
// launch state, launch actions, etc.) also sees a desktop-valid value.
describe("useHomeNextTargetSelectionState — stale cloud selection normalization", () => {
  it("normalizes a persisted cloud selection to worktree on Desktop", () => {
    cachedHomeNextTargetSelectionForTests({
      destination: "repository",
      repositorySelection: { kind: "auto" },
      repoLaunchKind: "cloud",
      baseBranchOverride: null,
    });

    const desktopHost = makeTestProductHost({ desktop: {} as object });
    const { result } = renderHook(() => useHomeNextTargetSelectionState(), {
      wrapper: productHostWrapper(desktopHost),
    });

    expect(result.current.desktopTargetsAvailable).toBe(true);
    expect(result.current.repoLaunchKind).toBe("worktree");
    expect(result.current.destination).toBe("repository");
  });

  it("negative control: keeps a persisted cloud selection unchanged on Web", () => {
    cachedHomeNextTargetSelectionForTests({
      destination: "repository",
      repositorySelection: { kind: "auto" },
      repoLaunchKind: "cloud",
      baseBranchOverride: null,
    });

    const webHost = makeTestProductHost({ desktop: null });
    const { result } = renderHook(() => useHomeNextTargetSelectionState(), {
      wrapper: productHostWrapper(webHost),
    });

    expect(result.current.desktopTargetsAvailable).toBe(false);
    expect(result.current.repoLaunchKind).toBe("cloud");
  });

  it("leaves a non-cloud Desktop selection untouched", () => {
    cachedHomeNextTargetSelectionForTests({
      destination: "repository",
      repositorySelection: { kind: "auto" },
      repoLaunchKind: "local",
      baseBranchOverride: null,
    });

    const desktopHost = makeTestProductHost({ desktop: {} as object });
    const { result } = renderHook(() => useHomeNextTargetSelectionState(), {
      wrapper: productHostWrapper(desktopHost),
    });

    expect(result.current.repoLaunchKind).toBe("local");
  });
});
