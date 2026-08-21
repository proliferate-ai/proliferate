// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToastInput } from "#product/primitives/utils/toast-model";
import {
  CLOUD_HARNESS_UPDATE_TOAST_ID,
  HarnessUpdateToastPresenter,
  HARNESS_UPDATE_TOAST_ID,
} from "#product/components/feedback/HarnessUpdateToastPresenter";

/**
 * The harness flow used to maintain its own toast card — its own frame, close
 * button and progress bar. It now raises kit weights like everything else, so
 * these tests assert the *input* it hands the kit: which weight, which copy,
 * which id, and — the point of this rewrite — that bytes appear only in the
 * downloading phase and never reach the accessible name. The frame itself is
 * the kit's, and is tested there.
 */

const state = vi.hoisted(() => {
  function component(overrides: Record<string, unknown> = {}) {
    return {
      agent: "codex",
      role: "native_cli",
      phase: "downloading",
      downloadedBytes: 42_000_000,
      downloadSizeBytes: 100_000_000,
      ...overrides,
    };
  }
  const localSnapshot = {
    jobId: "job-local",
    status: "running",
    currentAgent: "codex",
    progress: {
      downloadedBytes: 42_000_000,
      downloadSizeBytes: 100_000_000,
      completedComponents: 0,
      totalComponents: 1,
      components: [component()],
    },
  } as Record<string, unknown>;
  return {
    cloudActive: false,
    catalogCallCount: 0,
    defaultLocalSnapshot: localSnapshot,
    localSnapshot: localSnapshot as Record<string, unknown> | null,
    cloudSnapshot: null as null | Record<string, unknown>,
    component,
  };
});

const toastMocks = vi.hoisted(() => ({
  showToast: vi.fn((_input: unknown) => "toast-id"),
  dismissToast: vi.fn(),
}));

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("#product/primitives/utils/show-toast", () => toastMocks);
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));
vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => {
    state.catalogCallCount += 1;
    const cloudCall = state.cloudActive && state.catalogCallCount % 2 === 0;
    return {
      reconcileSnapshot: cloudCall ? state.cloudSnapshot : state.localSnapshot,
    };
  },
}));
vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));
vi.mock("#product/providers/CloudAnyHarnessRuntimeProvider", () => ({
  CloudAnyHarnessRuntimeProvider: ({ children }: { children: ReactNode }) => children,
}));

function raisedWithId(id: string): ToastInput | undefined {
  return toastMocks.showToast.mock.calls
    .map(([input]) => input as ToastInput)
    .find((input) => input.id === id);
}

/** Renders a ReactNode description to plain text, the way a screen would. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = false;
  state.catalogCallCount = 0;
  state.localSnapshot = state.defaultLocalSnapshot;
  state.cloudSnapshot = null;
});

describe("in-progress phase -> copy map", () => {
  it.each([
    {
      phase: "queued",
      component: state.component({ phase: "queued", downloadedBytes: 0, downloadSizeBytes: null }),
      title: "Preparing Codex",
      description: "Waiting to download.",
    },
    {
      phase: "downloading",
      component: state.component({ phase: "downloading" }),
      title: "Downloading Codex",
      description: "42 of 100 MB downloaded",
    },
    {
      phase: "verifying",
      component: state.component({ phase: "verifying" }),
      title: "Verifying Codex",
      description: "Checking the download.",
    },
    {
      phase: "extracting",
      component: state.component({ phase: "extracting" }),
      title: "Installing Codex",
      description: "Unpacking and installing.",
    },
    {
      phase: "installing",
      component: state.component({ phase: "installing" }),
      title: "Installing Codex",
      description: "Unpacking and installing.",
    },
    {
      phase: "finalizing",
      component: state.component({ phase: "finalizing" }),
      title: "Finishing Codex",
      description: "Wrapping up the install.",
    },
  ])("raises $phase as announcement weight with the phase's one detail", ({ component, title, description }) => {
    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      progress: {
        ...(state.defaultLocalSnapshot.progress as Record<string, unknown>),
        components: [component],
      },
    };
    render(<HarnessUpdateToastPresenter />);

    const toastInput = raisedWithId(HARNESS_UPDATE_TOAST_ID);
    expect(toastInput).toMatchObject({
      weight: "announcement",
      badge: "AGENTS",
      title,
      duration: Number.POSITIVE_INFINITY,
    });
    expect(textOf((toastInput as { description?: ReactNode })?.description)).toBe(description);
  });

  it("never announces the 'N of M components' fallback or a '· This machine' target label", () => {
    render(<HarnessUpdateToastPresenter />);

    const toastInput = raisedWithId(HARNESS_UPDATE_TOAST_ID);
    expect(JSON.stringify(toastInput)).not.toMatch(/components/i);
    expect(JSON.stringify(toastInput)).not.toMatch(/this machine/i);
  });
});

describe("bytes only in the downloading description", () => {
  it("carries the known-total form (X of Y MB downloaded)", () => {
    render(<HarnessUpdateToastPresenter />);
    const toastInput = raisedWithId(HARNESS_UPDATE_TOAST_ID) as { description?: ReactNode };
    expect(textOf(toastInput.description)).toBe("42 of 100 MB downloaded");
  });

  it("carries the unknown-total form (X MB downloaded) with no fake total", () => {
    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      progress: {
        ...(state.defaultLocalSnapshot.progress as Record<string, unknown>),
        components: [state.component({ phase: "downloading", downloadedBytes: 12_000_000, downloadSizeBytes: null })],
      },
    };
    render(<HarnessUpdateToastPresenter />);
    const toastInput = raisedWithId(HARNESS_UPDATE_TOAST_ID) as { description?: ReactNode };
    expect(textOf(toastInput.description)).toBe("12 MB downloaded");
  });

  it("uses the per-component byte counters, not the unreliable job aggregate", () => {
    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      progress: {
        downloadedBytes: 999_000_000,
        downloadSizeBytes: 999_000_000,
        completedComponents: 0,
        totalComponents: 1,
        components: [state.component({
          phase: "downloading",
          downloadedBytes: 5_000_000,
          downloadSizeBytes: 10_000_000,
        })],
      },
    };
    render(<HarnessUpdateToastPresenter />);
    const toastInput = raisedWithId(HARNESS_UPDATE_TOAST_ID) as { description?: ReactNode };
    expect(textOf(toastInput.description)).toBe("5 of 10 MB downloaded");
  });

  it.each(["queued", "verifying", "installing", "finalizing"])(
    "never puts a digit in the %s phase's description",
    (phase) => {
      state.localSnapshot = {
        ...state.defaultLocalSnapshot,
        progress: {
          ...(state.defaultLocalSnapshot.progress as Record<string, unknown>),
          components: [state.component({ phase, downloadedBytes: 42_000_000, downloadSizeBytes: 100_000_000 })],
        },
      };
      render(<HarnessUpdateToastPresenter />);
      const toastInput = raisedWithId(HARNESS_UPDATE_TOAST_ID) as { description?: ReactNode; title: string };
      expect(textOf(toastInput.description)).not.toMatch(/\d/);
      expect(toastInput.title).not.toMatch(/\d/);
    },
  );

  it("wraps the byte description in an aria-hidden node so it never reaches the live region", () => {
    render(<HarnessUpdateToastPresenter />);
    const toastInput = raisedWithId(HARNESS_UPDATE_TOAST_ID) as { description?: ReactNode };
    const description = toastInput.description;
    expect(isValidElement(description)).toBe(true);
    expect(isValidElement(description) && description.props["aria-hidden"]).toBe("true");
  });

  it("does not wrap non-byte descriptions in an aria-hidden node (they announce with the phase)", () => {
    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      progress: {
        ...(state.defaultLocalSnapshot.progress as Record<string, unknown>),
        components: [state.component({ phase: "verifying", downloadedBytes: 0, downloadSizeBytes: null })],
      },
    };
    render(<HarnessUpdateToastPresenter />);
    const toastInput = raisedWithId(HARNESS_UPDATE_TOAST_ID) as { description?: ReactNode };
    expect(typeof toastInput.description).toBe("string");
  });
});

describe("terminal triple", () => {
  it("closes with 'Agent tools ready' when an outcome was a fresh install", () => {
    const { rerender } = render(<HarnessUpdateToastPresenter />);
    vi.clearAllMocks();

    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      status: "completed",
      results: [
        { kind: "codex", outcome: "installed", installedArtifacts: [] },
      ],
    };
    rerender(<HarnessUpdateToastPresenter />);

    expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toMatchObject({
      message: "Agent tools ready",
      tone: "success",
    });
  });

  it("closes with 'Agent tools updated' when every outcome was already-installed", () => {
    const { rerender } = render(<HarnessUpdateToastPresenter />);
    vi.clearAllMocks();

    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      status: "completed",
      results: [
        { kind: "codex", outcome: "already_installed", installedArtifacts: [] },
      ],
    };
    rerender(<HarnessUpdateToastPresenter />);

    expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toMatchObject({
      message: "Agent tools updated",
      tone: "success",
    });
  });

  it("never derives ready-vs-updated from the reinstall/installedOnly flags", () => {
    const { rerender } = render(<HarnessUpdateToastPresenter />);
    vi.clearAllMocks();

    // reinstall: true would have meant "update" under the old flag-based
    // rule; the outcome (installed) must still win.
    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      status: "completed",
      reinstall: true,
      installedOnly: false,
      results: [
        { kind: "codex", outcome: "installed", installedArtifacts: [] },
      ],
    };
    rerender(<HarnessUpdateToastPresenter />);

    expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toMatchObject({
      message: "Agent tools ready",
    });
  });

  // D-R6: isFreshInstallJob(results) is false for both an empty result set
  // and an all-skipped job, which used to fall through to "Agent tools
  // updated" — a settled receipt for a job that changed nothing. Per the
  // ready-vs-updated ruling, outcomes that cannot distinguish must not be
  // improvised into a claim; the toast should close quietly instead.
  it("closes quietly with no success toast when every outcome was skipped", () => {
    const { rerender } = render(<HarnessUpdateToastPresenter />);
    vi.clearAllMocks();

    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      status: "completed",
      results: [
        { kind: "codex", outcome: "skipped", installedArtifacts: [] },
      ],
    };
    rerender(<HarnessUpdateToastPresenter />);

    expect(toastMocks.showToast).not.toHaveBeenCalled();
    expect(toastMocks.dismissToast).toHaveBeenCalledWith(HARNESS_UPDATE_TOAST_ID);
  });

  it("closes quietly with no success toast when the result set is empty", () => {
    const { rerender } = render(<HarnessUpdateToastPresenter />);
    vi.clearAllMocks();

    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      status: "completed",
      results: [],
    };
    rerender(<HarnessUpdateToastPresenter />);

    expect(toastMocks.showToast).not.toHaveBeenCalled();
    expect(toastMocks.dismissToast).toHaveBeenCalledWith(HARNESS_UPDATE_TOAST_ID);
  });

  it("names the failed and installed agents on partial failure, with a route to settings", () => {
    const { rerender } = render(<HarnessUpdateToastPresenter />);
    vi.clearAllMocks();

    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      status: "failed",
      results: [
        { kind: "codex", outcome: "failed", failureKind: "network", installedArtifacts: [] },
        { kind: "claude", outcome: "already_installed", installedArtifacts: [] },
        { kind: "cursor", outcome: "installed", installedArtifacts: [] },
      ],
    };
    rerender(<HarnessUpdateToastPresenter />);

    const toastInput = raisedWithId(HARNESS_UPDATE_TOAST_ID) as {
      weight: string;
      tone: string;
      badge: string;
      title: string;
      description: string;
      secondary: { label: string; onClick: () => void };
    };
    expect(toastInput).toMatchObject({
      weight: "announcement",
      tone: "warning",
      badge: "AGENTS",
      title: "Some agent tools aren't ready",
      description: "Codex failed (a network error). Claude Code and Cursor installed and remain usable.",
    });
    expect(toastInput.secondary.label).toBe("Open agent settings");
    toastInput.secondary.onClick();
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining("agent-codex"));
  });

  /**
   * D-R12. The runtime marks the whole job `failed` on exactly one path: the
   * install task itself dying. That path pushes no per-agent result for the
   * agent that died, so there is nobody to name — and the old copy
   * interpolated the empty name list anyway, producing a description that
   * began with a space, named no subject, and offered no route.
   */
  describe("a failed job with no failed result", () => {
    it("writes a subject-less failure as a sentence, keeping the still-usable clause", () => {
      const { rerender } = render(<HarnessUpdateToastPresenter />);
      vi.clearAllMocks();

      state.localSnapshot = {
        ...state.defaultLocalSnapshot,
        status: "failed",
        message: "agent reconcile task failed: panic",
        results: [
          { kind: "claude", outcome: "installed", installedArtifacts: [] },
        ],
      };
      rerender(<HarnessUpdateToastPresenter />);

      const toastInput = raisedWithId(HARNESS_UPDATE_TOAST_ID) as {
        title: string;
        description: string;
      };
      expect(toastInput.title).toBe("Some agent tools aren't ready");
      expect(toastInput.description).toBe(
        "The install stopped before it finished. Claude Code installed and remain usable. "
          + "You can retry from agent settings.",
      );
      expect(toastInput.description.startsWith(" ")).toBe(false);
      expect(toastInput.description).not.toContain(" failed (an unexpected error)");
    });

    it("says what happened and where to go, never the runtime's own message", () => {
      // `message` is internal text with no width budget and nothing a person
      // can act on, so the description stays a written sentence whatever the
      // runtime put in there.
      const { rerender } = render(<HarnessUpdateToastPresenter />);
      vi.clearAllMocks();

      state.localSnapshot = {
        ...state.defaultLocalSnapshot,
        status: "failed",
        message: "agent reconcile task failed: panic: called `Option::unwrap()` on a `None` value",
        results: [],
      };
      rerender(<HarnessUpdateToastPresenter />);

      expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toMatchObject({
        title: "Some agent tools aren't ready",
        description: "The install stopped before it finished. You can retry from agent settings.",
      });
    });

    it("keeps naming the agent whenever there is one to name", () => {
      // The message must not displace a real named subject: a job that both
      // failed at the job level and reported a failed agent still reads as
      // that agent's failure.
      const { rerender } = render(<HarnessUpdateToastPresenter />);
      vi.clearAllMocks();

      state.localSnapshot = {
        ...state.defaultLocalSnapshot,
        status: "failed",
        message: "agent reconcile task failed: panic",
        results: [
          { kind: "codex", outcome: "failed", failureKind: "disk", installedArtifacts: [] },
        ],
      };
      rerender(<HarnessUpdateToastPresenter />);

      // The named form says who and why, and the secondary action carries the
      // route, so it does not also take the subject-less retry sentence.
      expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toMatchObject({
        description: "Codex failed (not enough disk space).",
      });
    });
  });
});

describe("dismissal persistence", () => {
  it("keeps a dismissed active job hidden until a different job starts", () => {
    const { rerender } = render(<HarnessUpdateToastPresenter />);
    const toastInput = toastMocks.showToast.mock.calls[0]?.[0] as unknown as {
      onDismiss: () => void;
    };
    expect(toastInput.onDismiss).toBeTypeOf("function");

    toastInput.onDismiss();
    vi.clearAllMocks();
    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      progress: {
        ...(state.defaultLocalSnapshot.progress as Record<string, unknown>),
        components: [state.component({ downloadedBytes: 55_000_000 })],
      },
    };
    rerender(<HarnessUpdateToastPresenter />);
    expect(toastMocks.showToast).not.toHaveBeenCalled();

    state.localSnapshot = { ...state.localSnapshot, status: "completed" };
    rerender(<HarnessUpdateToastPresenter />);
    expect(toastMocks.showToast).not.toHaveBeenCalled();

    state.localSnapshot = { ...state.defaultLocalSnapshot, jobId: "job-local-2" };
    rerender(<HarnessUpdateToastPresenter />);
    expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toBeTruthy();
  });
});

describe("dismissed progress must not cost a failure report (D-R4)", () => {
  it("still shows the failure toast even though the in-progress toast was dismissed", () => {
    const { rerender } = render(<HarnessUpdateToastPresenter />);
    const toastInput = toastMocks.showToast.mock.calls[0]?.[0] as unknown as {
      onDismiss: () => void;
    };
    toastInput.onDismiss();
    vi.clearAllMocks();

    // Same job, now resolved with a failure. Dismissing the download bar is
    // not consent to silently drop the "your agent tools aren't ready"
    // report — that decision (who failed, why, what to do) must still land.
    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      status: "failed",
      results: [
        { kind: "codex", outcome: "failed", failureKind: "network", installedArtifacts: [] },
      ],
    };
    rerender(<HarnessUpdateToastPresenter />);

    expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toMatchObject({
      tone: "warning",
      title: "Some agent tools aren't ready",
    });
  });

  it("still stays quiet on a dismissed job's plain success (contrast case)", () => {
    const { rerender } = render(<HarnessUpdateToastPresenter />);
    const toastInput = toastMocks.showToast.mock.calls[0]?.[0] as unknown as {
      onDismiss: () => void;
    };
    toastInput.onDismiss();
    vi.clearAllMocks();

    state.localSnapshot = {
      ...state.defaultLocalSnapshot,
      status: "completed",
      results: [
        { kind: "codex", outcome: "installed", installedArtifacts: [] },
      ],
    };
    rerender(<HarnessUpdateToastPresenter />);

    expect(toastMocks.showToast).not.toHaveBeenCalled();
  });
});

describe("cloud vs local toast ids", () => {
  it("shows shared Cloud progress under its own id, with no workspace target label", async () => {
    state.cloudActive = true;
    state.localSnapshot = null;
    state.cloudSnapshot = {
      jobId: "job-cloud",
      status: "running",
      currentAgent: "claude",
      progress: {
        downloadedBytes: 12_000_000,
        downloadSizeBytes: null,
        completedComponents: 0,
        totalComponents: 1,
        components: [state.component({
          agent: "claude",
          role: "agent_process",
          phase: "installing",
          downloadedBytes: 12_000_000,
          downloadSizeBytes: null,
        })],
      },
    };
    render(<HarnessUpdateToastPresenter />);

    await waitFor(() => {
      expect(raisedWithId(CLOUD_HARNESS_UPDATE_TOAST_ID)).toBeTruthy();
    });
    const toastInput = raisedWithId(CLOUD_HARNESS_UPDATE_TOAST_ID) as { title: string };
    expect(toastInput.title).toBe("Installing Claude Code");
    // The label this test names — a workspace target suffix like
    // "· This machine" — was "Proliferate Cloud", not the literal word
    // "workspace" (D-R3: the old assertion could never fail against any
    // version of this presenter).
    expect(JSON.stringify(toastInput)).not.toMatch(/Proliferate Cloud/i);
  });

  it("can keep deterministic playground progress local-only", async () => {
    state.cloudActive = true;
    render(<HarnessUpdateToastPresenter includeCloud={false} />);

    await waitFor(() => {
      expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toBeTruthy();
    });
    expect(raisedWithId(CLOUD_HARNESS_UPDATE_TOAST_ID)).toBeUndefined();
  });
});
