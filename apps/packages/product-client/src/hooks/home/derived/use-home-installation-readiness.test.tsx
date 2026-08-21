// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeInstallationReadiness } from "#product/hooks/home/derived/use-home-installation-readiness";

/**
 * D-R1/D-R2: the readiness card used to be fed hand-built ready/installing
 * arrays derived from the general agents list, which is (a) a stale sample
 * disjoint from the entire install window on a fresh machine, and (b) only
 * ever able to name a single "current" agent. Neither bug is reachable by a
 * pure-function test over literal arrays — this drives the card through the
 * real hook, from a reconcile job snapshot exactly as
 * useAgentReconcileStatusQuery would hand it back mid-job, with multiple
 * agents each carrying their own component progress simultaneously.
 */

const catalogMocks = vi.hoisted(() => ({
  reconcileSnapshot: null as Record<string, unknown> | null,
  reconcileIsError: false,
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    reconcileSnapshot: catalogMocks.reconcileSnapshot,
    reconcileIsError: catalogMocks.reconcileIsError,
  }),
}));

beforeEach(() => {
  catalogMocks.reconcileSnapshot = null;
  catalogMocks.reconcileIsError = false;
});

function multiAgentSnapshot() {
  return {
    jobId: "job-multi",
    status: "running",
    currentAgent: "codex",
    progress: {
      downloadedBytes: 0,
      downloadSizeBytes: null,
      completedComponents: 2,
      totalComponents: 6,
      components: [
        // Claude: both of its components already settled — ready.
        { agent: "claude", role: "native_cli", phase: "completed", downloadedBytes: 0, downloadSizeBytes: null },
        { agent: "claude", role: "agent_process", phase: "completed", downloadedBytes: 0, downloadSizeBytes: null },
        // Codex: the runtime's single "current" agent — still downloading.
        { agent: "codex", role: "native_cli", phase: "downloading", downloadedBytes: 5_000_000, downloadSizeBytes: 20_000_000 },
        // Cursor and OpenCode haven't started yet, but the job already knows
        // about them — this is exactly what the stale agents-list read
        // could never see (D-R1), and what current_agent-only tracking
        // could never name (D-R2: at most one "installing" agent, ever).
        { agent: "cursor", role: "native_cli", phase: "queued", downloadedBytes: 0, downloadSizeBytes: null },
        { agent: "opencode", role: "native_cli", phase: "queued", downloadedBytes: 0, downloadSizeBytes: null },
      ],
    },
  };
}

describe("useHomeInstallationReadiness (job-snapshot wiring)", () => {
  it("is null with no active job", () => {
    catalogMocks.reconcileSnapshot = null;
    const { result } = renderHook(() => useHomeInstallationReadiness("selection_required"));
    expect(result.current).toBeNull();
  });

  it("appears mid-job, naming the agent that finished first and overflowing the rest", () => {
    catalogMocks.reconcileSnapshot = multiAgentSnapshot();
    const { result } = renderHook(() => useHomeInstallationReadiness("selection_required"));

    // This is unreachable from a stale agents-list read (D-R1: sampled
    // before the job starts, refetched only after it ends) and unreachable
    // from current_agent-only tracking (D-R2: only ever one "installing"
    // agent) — it can only pass by reading the job snapshot's own
    // per-component progress, which knows all four agents at once.
    expect(result.current).toEqual({
      agentKind: "claude",
      title: "Claude Code is ready.",
      description: "Codex and 2 others are still installing.",
    });
  });

  it("adds 'You can start now.' once the gate is launchable, not at selection_required", () => {
    catalogMocks.reconcileSnapshot = multiAgentSnapshot();

    const { result: selectionRequired } = renderHook(() =>
      useHomeInstallationReadiness("selection_required")
    );
    expect(selectionRequired.current?.description).not.toMatch(/you can start now/i);

    const { result: launchable } = renderHook(() => useHomeInstallationReadiness("launchable"));
    expect(launchable.current?.description).toMatch(/^You can start now\./);
  });

  it("unmounts (returns null) once the job resolves and nothing is left installing", () => {
    catalogMocks.reconcileSnapshot = {
      jobId: "job-multi",
      status: "completed",
      progress: {
        downloadedBytes: 0,
        downloadSizeBytes: null,
        completedComponents: 2,
        totalComponents: 2,
        components: [
          { agent: "claude", role: "native_cli", phase: "completed", downloadedBytes: 0, downloadSizeBytes: null },
          { agent: "codex", role: "native_cli", phase: "completed", downloadedBytes: 0, downloadSizeBytes: null },
        ],
      },
    };
    const { result } = renderHook(() => useHomeInstallationReadiness("launchable"));
    expect(result.current).toBeNull();
  });

  /**
   * D-R16: the card's most common real case, driven through the real hook.
   * A reconcile of an up-to-date machine reports every already-installed
   * component as `skipped` (install_pinned_role), and those phases survive to
   * job completion. Reading phases alone blanked the card here.
   */
  it("names already-installed agents ready from the job's own results", () => {
    catalogMocks.reconcileSnapshot = {
      jobId: "job-uptodate",
      status: "running",
      currentAgent: "grok",
      results: [
        { kind: "claude", outcome: "already_installed", installedArtifacts: [] },
        { kind: "codex", outcome: "already_installed", installedArtifacts: [] },
      ],
      progress: {
        downloadedBytes: 0,
        downloadSizeBytes: null,
        completedComponents: 2,
        totalComponents: 3,
        components: [
          { agent: "claude", role: "native_cli", phase: "skipped", downloadedBytes: 0, downloadSizeBytes: null },
          { agent: "codex", role: "native_cli", phase: "skipped", downloadedBytes: 0, downloadSizeBytes: null },
          { agent: "grok", role: "native_cli", phase: "downloading", downloadedBytes: 1_000_000, downloadSizeBytes: 9_000_000 },
        ],
      },
    };
    const { result } = renderHook(() => useHomeInstallationReadiness("launchable"));
    expect(result.current).toEqual({
      agentKind: "claude",
      title: "Claude Code is ready.",
      description: "You can start now. Grok is still installing.",
    });
  });

  /**
   * D-R10: the card used to read phases alone, so a snapshot that stopped
   * being updated left a permanent, false progress claim on the home screen.
   * Both cases below are frozen snapshots whose components still read as a
   * live install and would have rendered a card indefinitely.
   */
  describe("frozen snapshots", () => {
    // The runtime's panic path marks the job failed and returns without
    // finishing the agents it never reached, so those stay `queued`.
    function panickedSnapshot() {
      return {
        jobId: "job-panic",
        status: "failed",
        message: "agent reconcile task failed: panic",
        progress: {
          downloadedBytes: 0,
          downloadSizeBytes: null,
          completedComponents: 1,
          totalComponents: 3,
          components: [
            { agent: "claude", role: "native_cli", phase: "completed", downloadedBytes: 0, downloadSizeBytes: null },
            { agent: "codex", role: "native_cli", phase: "queued", downloadedBytes: 0, downloadSizeBytes: null },
            { agent: "opencode", role: "native_cli", phase: "queued", downloadedBytes: 0, downloadSizeBytes: null },
          ],
        },
      };
    }

    it("shows nothing for a failed job whose unreached agents are stuck at queued", () => {
      catalogMocks.reconcileSnapshot = panickedSnapshot();
      const { result } = renderHook(() => useHomeInstallationReadiness("launchable"));
      expect(result.current).toBeNull();
    });

    it("shows nothing once the poll has errored out under a retained running snapshot", () => {
      // resolveAgentReconcileRefetchInterval returns false on a 404 even when
      // the retained data says `running`, so polling stops for good while
      // React Query keeps handing back the last mid-job snapshot.
      catalogMocks.reconcileSnapshot = multiAgentSnapshot();
      catalogMocks.reconcileIsError = true;
      const { result } = renderHook(() => useHomeInstallationReadiness("launchable"));
      expect(result.current).toBeNull();
    });

    it("still shows the card for the same snapshot while the poll is healthy", () => {
      catalogMocks.reconcileSnapshot = multiAgentSnapshot();
      catalogMocks.reconcileIsError = false;
      const { result } = renderHook(() => useHomeInstallationReadiness("launchable"));
      expect(result.current).not.toBeNull();
    });
  });
});
