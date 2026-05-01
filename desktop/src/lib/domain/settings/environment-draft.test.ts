import { describe, expect, it } from "vitest";
import {
  buildConfiguredCloudEnvironmentDraft,
  buildCloudEnvironmentDisablePayload,
  buildCloudEnvironmentSavePayload,
  buildDisabledCloudEnvironmentDraft,
  buildInitialCloudEnvironmentDraftState,
  buildLocalEnvironmentSavePatch,
  buildSavedCloudEnvironmentDraftState,
  isCloudEnvironmentDraftConfigurable,
  isCloudEnvironmentDraftDirty,
  isLocalEnvironmentDraftDirty,
  normalizeLocalEnvironmentDraft,
} from "@/lib/domain/settings/environment-draft";

describe("local environment drafts", () => {
  it("marks local branch, run command, and setup edits dirty without producing a save patch until requested", () => {
    const baseline = normalizeLocalEnvironmentDraft({
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });
    const draft = normalizeLocalEnvironmentDraft({
      defaultBranch: "release",
      setupScript: "pnpm install\npnpm build",
      runCommand: "make dev",
    });

    expect(isLocalEnvironmentDraftDirty(draft, baseline)).toBe(true);
    expect(buildLocalEnvironmentSavePatch(draft)).toEqual({
      defaultBranch: "release",
      setupScript: "pnpm install\npnpm build",
      runCommand: "make dev",
    });
  });

  it("reverts by restoring the persisted local baseline", () => {
    const baseline = normalizeLocalEnvironmentDraft({
      defaultBranch: " main ",
      setupScript: "uv sync",
      runCommand: "make dev",
    });

    expect(normalizeLocalEnvironmentDraft(baseline)).toEqual({
      defaultBranch: "main",
      setupScript: "uv sync",
      runCommand: "make dev",
    });
    expect(isLocalEnvironmentDraftDirty(baseline, baseline)).toBe(false);
  });
});

describe("cloud environment drafts", () => {
  it("resets from async saved config while pristine", () => {
    const initial = buildInitialCloudEnvironmentDraftState(null, {
      setupScript: "",
      runCommand: "",
    });
    const saved = buildSavedCloudEnvironmentDraftState({
      configured: true,
      defaultBranch: "main",
      envVars: { API_BASE_URL: "https://example.test" },
      trackedFiles: [{ relativePath: ".env.local" }],
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });

    expect(isCloudEnvironmentDraftConfigurable(initial.draft, initial.baseline)).toBe(true);
    expect(isCloudEnvironmentDraftDirty(initial.draft, initial.revertDraft)).toBe(false);
    expect(isCloudEnvironmentDraftDirty(saved.draft, saved.revertDraft)).toBe(false);
    expect(saved.draft).toEqual({
      configured: true,
      defaultBranch: "main",
      envVars: { API_BASE_URL: "https://example.test" },
      trackedFilePaths: [".env.local"],
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });
  });

  it("makes an unconfigured cloud draft seeded from persisted local values configurable", () => {
    const state = buildInitialCloudEnvironmentDraftState({ configured: false }, {
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });

    expect(state.baseline).toEqual({
      configured: false,
      defaultBranch: null,
      envVars: {},
      trackedFilePaths: [],
      setupScript: "",
      runCommand: "",
    });
    expect(state.draft).toMatchObject({
      configured: true,
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });
    expect(state.revertDraft).toEqual(state.draft);
    expect(isCloudEnvironmentDraftConfigurable(state.draft, state.baseline)).toBe(true);
    expect(isCloudEnvironmentDraftDirty(state.draft, state.revertDraft)).toBe(false);
  });

  it("treats all-empty unconfigured cloud drafts as explicitly configurable", () => {
    const state = buildInitialCloudEnvironmentDraftState(undefined, {
      setupScript: "",
      runCommand: "",
    });

    expect(state.draft).toEqual({
      configured: true,
      defaultBranch: null,
      envVars: {},
      trackedFilePaths: [],
      setupScript: "",
      runCommand: "",
    });
    expect(isCloudEnvironmentDraftConfigurable(state.draft, state.baseline)).toBe(true);
    expect(isCloudEnvironmentDraftDirty(state.draft, state.revertDraft)).toBe(false);
  });

  it("marks user edits dirty separately from first-time configurability", () => {
    const state = buildInitialCloudEnvironmentDraftState(undefined, {
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });

    const edited = buildConfiguredCloudEnvironmentDraft(state.draft, {
      runCommand: "make dev",
    });

    expect(isCloudEnvironmentDraftConfigurable(state.draft, state.baseline)).toBe(true);
    expect(isCloudEnvironmentDraftDirty(edited, state.revertDraft)).toBe(true);
    expect(buildCloudEnvironmentSavePayload(edited)).toMatchObject({
      configured: true,
      setupScript: "pnpm install",
      runCommand: "make dev",
    });
  });

  it("builds a configured payload when editing after a pending disable", () => {
    const edited = buildConfiguredCloudEnvironmentDraft(
      buildDisabledCloudEnvironmentDraft(),
      { setupScript: "pnpm install" },
    );

    expect(buildCloudEnvironmentSavePayload(edited)).toEqual({
      configured: true,
      defaultBranch: null,
      envVars: {},
      trackedFilePaths: [],
      setupScript: "pnpm install",
      runCommand: "",
    });
  });

  it("builds cloud disable drafts and clear payloads with required fields", () => {
    expect(buildDisabledCloudEnvironmentDraft()).toEqual({
      configured: false,
      defaultBranch: null,
      envVars: {},
      trackedFilePaths: [],
      setupScript: "",
      runCommand: "",
    });
    expect(buildCloudEnvironmentDisablePayload()).toEqual({
      configured: false,
      defaultBranch: null,
      envVars: {},
      trackedFilePaths: [],
      setupScript: "",
      runCommand: "",
    });
    expect(buildCloudEnvironmentSavePayload(buildDisabledCloudEnvironmentDraft())).toEqual(
      buildCloudEnvironmentDisablePayload(),
    );
  });
});
