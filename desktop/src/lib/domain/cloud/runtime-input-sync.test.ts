import { describe, expect, it } from "vitest";
import {
  createRuntimeInputSyncQueueState,
  credentialProviderForEnvVar,
  dequeueRuntimeInputSyncDescriptor,
  enqueueRuntimeInputSyncDescriptors,
  normalizeRuntimeInputSyncDescriptor,
  runtimeInputSyncDescriptorEffectiveSourceKey,
} from "./runtime-input-sync";

describe("runtime input sync domain", () => {
  it("filters supported cloud credential env vars", () => {
    expect(credentialProviderForEnvVar("ANTHROPIC_API_KEY")).toBe("claude");
    expect(credentialProviderForEnvVar("GEMINI_API_KEY")).toBe("gemini");
    expect(credentialProviderForEnvVar("GOOGLE_API_KEY")).toBe("gemini");
    expect(credentialProviderForEnvVar("GOOGLE_GENAI_USE_VERTEXAI")).toBe("gemini");
    expect(credentialProviderForEnvVar("OPENAI_API_KEY")).toBeNull();
    expect(credentialProviderForEnvVar("CODEX_API_KEY")).toBeNull();
  });

  it("dedupes descriptors without persisting payloads", () => {
    const state = enqueueRuntimeInputSyncDescriptors(
      createRuntimeInputSyncQueueState(),
      [
        { kind: "credential", provider: "claude" },
        { kind: "credential", provider: "claude" },
        {
          kind: "repo_tracked_file",
          gitOwner: "acme",
          gitRepoName: "rocket",
          localWorkspaceId: "workspace",
          repoRootId: "repo-root",
          relativePath: "config/.env",
        },
        {
          kind: "repo_tracked_file",
          gitOwner: "acme",
          gitRepoName: "rocket",
          localWorkspaceId: "workspace",
          relativePath: "config/.env",
        },
      ],
    );

    expect(state.items).toEqual([
      { kind: "credential", provider: "claude" },
      {
        kind: "repo_tracked_file",
        gitOwner: "acme",
        gitRepoName: "rocket",
        localWorkspaceId: "workspace",
        repoRootId: "repo-root",
        relativePath: "config/.env",
      },
    ]);
  });

  it("rejects unsafe repo file descriptors", () => {
    expect(normalizeRuntimeInputSyncDescriptor({
      kind: "repo_tracked_file",
      gitOwner: "acme",
      gitRepoName: "rocket",
      repoRootId: "repo-root",
      relativePath: "../.env",
    })).toBeNull();
    expect(normalizeRuntimeInputSyncDescriptor({
      kind: "repo_tracked_file",
      gitOwner: "acme",
      gitRepoName: "rocket",
      repoRootId: "repo-root",
      relativePath: "config/.env",
    })).toEqual({
      kind: "repo_tracked_file",
      gitOwner: "acme",
      gitRepoName: "rocket",
      localWorkspaceId: null,
      repoRootId: "repo-root",
      relativePath: "config/.env",
    });
  });

  it("uses workspace-first source keys for repo tracked file descriptors", () => {
    expect(runtimeInputSyncDescriptorEffectiveSourceKey({
      kind: "repo_tracked_file",
      gitOwner: "acme",
      gitRepoName: "rocket",
      localWorkspaceId: "workspace",
      repoRootId: "repo-root",
      relativePath: "config/.env",
    })).toBe("workspace:workspace");
    expect(runtimeInputSyncDescriptorEffectiveSourceKey({
      kind: "repo_tracked_file",
      gitOwner: "acme",
      gitRepoName: "rocket",
      repoRootId: "repo-root",
      relativePath: "config/.env",
    })).toBe("repo-root:repo-root");
  });

  it("removes descriptor keys after dequeue", () => {
    const queued = enqueueRuntimeInputSyncDescriptors(
      createRuntimeInputSyncQueueState(),
      [{ kind: "credential", provider: "gemini" }],
    );
    const first = dequeueRuntimeInputSyncDescriptor(queued);
    expect(first.descriptor).toEqual({ kind: "credential", provider: "gemini" });

    const requeued = enqueueRuntimeInputSyncDescriptors(first.state, [
      { kind: "credential", provider: "gemini" },
    ]);
    expect(requeued.items).toEqual([{ kind: "credential", provider: "gemini" }]);
  });
});
