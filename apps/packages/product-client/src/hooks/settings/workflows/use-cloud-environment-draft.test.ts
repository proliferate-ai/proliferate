// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RepoEnvironmentResponse } from "@proliferate/cloud-sdk";
import { useCloudEnvironmentDraft } from "./use-cloud-environment-draft";

function environmentFixture(
  overrides: Partial<RepoEnvironmentResponse> = {},
): RepoEnvironmentResponse {
  return {
    id: "env-1",
    repoConfigId: "repo-1",
    kind: "cloud",
    desktopInstallId: null,
    localPath: null,
    defaultBranch: "main",
    setupScript: "pnpm install",
    runCommand: "pnpm dev",
    ...overrides,
  } as RepoEnvironmentResponse;
}

describe("useCloudEnvironmentDraft", () => {
  it("seeds an unsaved environment and allows saving while clean", () => {
    const { result } = renderHook(() => useCloudEnvironmentDraft({
      environment: null,
      sourceKey: "octo/rocket",
      seed: { setupScript: "make setup", runCommand: "make dev" },
    }));

    expect(result.current.defaultBranch).toBeNull();
    expect(result.current.setupScript).toBe("make setup");
    expect(result.current.runCommand).toBe("make dev");
    expect(result.current.dirty).toBe(false);
    expect(result.current.canSave).toBe(true);
  });

  it("baselines from a saved environment and toggles dirty through edits and revert", () => {
    const { result } = renderHook(() => useCloudEnvironmentDraft({
      environment: environmentFixture(),
      sourceKey: "octo/rocket",
    }));

    expect(result.current.setupScript).toBe("pnpm install");
    expect(result.current.dirty).toBe(false);
    expect(result.current.canSave).toBe(false);

    act(() => {
      result.current.setRunCommand("pnpm start");
    });
    expect(result.current.dirty).toBe(true);
    expect(result.current.canSave).toBe(true);

    act(() => {
      result.current.revert();
    });
    expect(result.current.runCommand).toBe("pnpm dev");
    expect(result.current.dirty).toBe(false);
    expect(result.current.canSave).toBe(false);
  });

  it("re-baselines after reset with the saved response", () => {
    const saved = environmentFixture({ runCommand: "pnpm start" });
    const { result, rerender } = renderHook(
      (props: { environment: RepoEnvironmentResponse | null }) => useCloudEnvironmentDraft({
        environment: props.environment,
        sourceKey: "octo/rocket",
      }),
      { initialProps: { environment: environmentFixture() } },
    );

    act(() => {
      result.current.setRunCommand("pnpm start");
    });
    expect(result.current.dirty).toBe(true);

    act(() => {
      result.current.reset(saved);
    });
    expect(result.current.dirty).toBe(false);

    rerender({ environment: saved });
    expect(result.current.runCommand).toBe("pnpm start");
    expect(result.current.dirty).toBe(false);
    expect(result.current.canSave).toBe(false);
  });

  it("discards a dirty draft when the source key changes", () => {
    const { result, rerender } = renderHook(
      (props: { environment: RepoEnvironmentResponse | null; sourceKey: string }) =>
        useCloudEnvironmentDraft(props),
      {
        initialProps: {
          environment: environmentFixture() as RepoEnvironmentResponse | null,
          sourceKey: "octo/rocket",
        },
      },
    );

    act(() => {
      result.current.setSetupScript("echo dirty");
    });
    expect(result.current.dirty).toBe(true);

    rerender({
      environment: environmentFixture({ id: "env-2", setupScript: "npm ci" }),
      sourceKey: "octo/booster",
    });
    expect(result.current.setupScript).toBe("npm ci");
    expect(result.current.dirty).toBe(false);
  });

  it("re-baselines on baseline changes only while clean", () => {
    const { result, rerender } = renderHook(
      (props: { environment: RepoEnvironmentResponse | null }) => useCloudEnvironmentDraft({
        environment: props.environment,
        sourceKey: "octo/rocket",
      }),
      { initialProps: { environment: environmentFixture() } },
    );

    rerender({ environment: environmentFixture({ runCommand: "pnpm preview" }) });
    expect(result.current.runCommand).toBe("pnpm preview");
    expect(result.current.dirty).toBe(false);

    act(() => {
      result.current.setRunCommand("pnpm edited");
    });
    rerender({ environment: environmentFixture({ runCommand: "pnpm refetched" }) });
    expect(result.current.runCommand).toBe("pnpm edited");
    expect(result.current.dirty).toBe(true);
  });
});
