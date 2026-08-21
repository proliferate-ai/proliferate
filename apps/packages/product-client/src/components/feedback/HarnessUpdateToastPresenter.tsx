import { lazy, Suspense, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AgentInstallProgressComponent,
  ReconcileAgentResult,
  ReconcileAgentsResponse,
} from "@anyharness/sdk";
import { dismissToast, showToast } from "#product/primitives/utils/show-toast";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { formatDownloadedMegabytesLine } from "#product/lib/domain/updates/byte-progress";
import { getAgentDisplayLabel } from "#product/lib/domain/agents/provider-display";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";
import type { SettingsSection } from "#product/config/settings";

const LazyCloudAnyHarnessRuntimeProvider = lazy(() =>
  import("#product/providers/CloudAnyHarnessRuntimeProvider").then((module) => ({
    default: module.CloudAnyHarnessRuntimeProvider,
  }))
);

export const HARNESS_UPDATE_TOAST_ID = "harness-update:local";
export const CLOUD_HARNESS_UPDATE_TOAST_ID = "harness-update:cloud";

// Human phrasing for the runtime's typed install-failure enum
// (InstallErrorKind). Absent/unknown kinds fall back silently to the generic
// receipt, so a runtime that predates typed failures degrades cleanly.
const FAILURE_KIND_REASON: Record<string, string> = {
  network: "a network error",
  checksum: "a checksum mismatch",
  in_use: "the tool was in use",
  disk: "not enough disk space",
  other: "an unexpected error",
};

// One user-facing verb per wire phase (HANDOFF: HarnessUpdateToastPresenter).
// extracting/installing share "Installing" — one verb covers both wire phases.
const PHASE_VERB: Record<string, string> = {
  queued: "Preparing",
  downloading: "Downloading",
  verifying: "Verifying",
  extracting: "Installing",
  installing: "Installing",
  finalizing: "Finishing",
};

const KNOWN_HARNESS_SETTINGS_SECTIONS: Record<string, SettingsSection> = {
  claude: "agent-claude",
  codex: "agent-codex",
  opencode: "agent-opencode",
  grok: "agent-grok",
  cursor: "agent-cursor",
};

function harnessSettingsSection(kind: string): SettingsSection {
  return KNOWN_HARNESS_SETTINGS_SECTIONS[kind] ?? "agent-claude";
}

/** "A" | "A and B" | "A, B and C" — never an Oxford comma, matching prose copy. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The partial-failure terminal's description: names who failed and why, and
 * who is still usable. Reuses the typed-failure reason map; a mixed set of
 * failure kinds (or none reported) reads as "an unexpected error" rather than
 * naming one kind that does not cover every failure.
 *
 * A job can be `failed` with no failed result at all (D-R12). The runtime
 * marks the whole job failed on the one path where the install task itself
 * dies, and that path pushes no per-agent result for the agent that died, so
 * there is no name to print. The old copy interpolated the empty name list
 * anyway and rendered " failed (an unexpected error)." — a leading space, no
 * subject, and no route. That case now gets a written sentence of its own.
 *
 * Deliberately not the job's `message`: it is internal runtime text ("agent
 * reconcile task failed: panic: ...") with no width budget, no guarantee of
 * being a sentence, and nothing a person can act on. A toast is the wrong
 * home for it; the retry route is the useful thing to say instead.
 */
function describePartialFailure(results: readonly ReconcileAgentResult[]): string {
  const failed = results.filter((result) => result.outcome === "failed");
  const installed = results.filter((result) =>
    result.outcome === "installed" || result.outcome === "already_installed"
  );
  const failedNames = failed.map((result) => getAgentDisplayLabel(result.kind));
  const installedNames = installed.map((result) => getAgentDisplayLabel(result.kind));
  const kinds = new Set(
    failed
      .map((result) => result.failureKind)
      .filter((kind): kind is string => typeof kind === "string" && kind.length > 0),
  );
  const reason = kinds.size === 1
    ? FAILURE_KIND_REASON[[...kinds][0]] ?? "an unexpected error"
    : "an unexpected error";
  const named = failedNames.length > 0;
  const failedSentence = named
    ? `${joinNames(failedNames)} failed (${reason}).`
    : "The install stopped before it finished.";
  const installedSentence = installedNames.length > 0
    ? `${joinNames(installedNames)} installed and remain usable.`
    : "";
  // Only when nobody is named: the named form already says who and why, and
  // the secondary action carries the route. With no subject and no reason,
  // this sentence is the only actionable thing in the description.
  const retrySentence = named ? "" : "You can retry from agent settings.";
  return [failedSentence, installedSentence, retrySentence].filter(Boolean).join(" ");
}

/**
 * Ready-vs-updated derivation (ruling: never from `reinstall`/`installedOnly`).
 * The runtime's per-agent `ReconcileOutcome` is the only source of truth: any
 * agent whose outcome is `installed` means this job put something on disk
 * that was not there before, which is what "first run" means from the user's
 * side — a job made only of `already_installed` results touched nothing new,
 * which is what "updated" means once nothing failed.
 */
function isFreshInstallJob(results: readonly ReconcileAgentResult[]): boolean {
  return results.some((result) => result.outcome === "installed");
}

/**
 * Whether the job's outcomes say anything happened at all. An empty result
 * set or a job whose every result is `skipped` changed nothing — neither
 * "ready" nor "updated" is true of it, and the outcomes cannot distinguish
 * which one it would have been (D-R6). Per the ready-vs-updated ruling, an
 * outcome set that cannot decide is reported honestly rather than
 * improvised: this job raises no success receipt at all.
 */
function hasAnyMeaningfulOutcome(results: readonly ReconcileAgentResult[]): boolean {
  return results.some((result) =>
    result.outcome === "installed" || result.outcome === "already_installed"
  );
}

function findCurrentComponent(
  components: readonly AgentInstallProgressComponent[],
): AgentInstallProgressComponent | undefined {
  return components.find((component) =>
    !["completed", "skipped", "failed"].includes(component.phase)
  );
}

interface HarnessProgressToastOptions {
  snapshot: ReconcileAgentsResponse | null;
  toastId: string;
}

function useHarnessProgressToast({
  snapshot,
  toastId,
}: HarnessProgressToastOptions) {
  const navigate = useNavigate();
  const activeJobId = useRef<string | null>(null);
  const dismissedJobId = useRef<string | null>(null);
  const progress = snapshot?.progress ?? null;
  const isActive = snapshot?.status === "queued" || snapshot?.status === "running";

  useEffect(() => () => {
    dismissToast(toastId);
  }, [toastId]);

  useEffect(() => {
    if (!isActive || !progress) {
      if (activeJobId.current) {
        const snapshotJobId = snapshot?.jobId ?? toastId;
        const sameJob = snapshotJobId === activeJobId.current;
        const wasDismissed = dismissedJobId.current === activeJobId.current;
        const isTerminal = snapshot?.status === "completed" || snapshot?.status === "failed";
        if (sameJob && isTerminal) {
          const results = snapshot?.results ?? [];
          const failed = snapshot?.status === "failed"
            || results.some((result) => result.outcome === "failed")
            || false;
          // The outcome is a resolution, so it gets the weight its content
          // earns: a success is a one-line receipt, a failure is a decision
          // (who failed, why, what still works, where to go). A failure is
          // always shown, dismissed progress or not (D-R4): swiping away
          // "Downloading Claude Code" is not consent to silently lose the
          // "your agent tools aren't ready" report.
          if (failed) {
            const failedResult = results.find((result) => result.outcome === "failed");
            showToast({
              id: toastId,
              weight: "announcement",
              tone: "warning",
              badge: "AGENTS",
              title: "Some agent tools aren't ready",
              description: describePartialFailure(results),
              secondary: {
                label: "Open agent settings",
                onClick: () => {
                  navigate(buildSettingsHref({
                    section: harnessSettingsSection(failedResult?.kind ?? "claude"),
                  }));
                },
              },
            });
          } else if (!wasDismissed) {
            if (hasAnyMeaningfulOutcome(results)) {
              showToast({
                id: toastId,
                message: isFreshInstallJob(results) ? "Agent tools ready" : "Agent tools updated",
                tone: "success",
              });
            } else {
              // Nothing installed and nothing confirmed present (D-R6): an
              // empty or all-skipped result changed nothing, so close
              // quietly rather than raise a false "ready"/"updated" receipt.
              dismissToast(toastId);
            }
          }
        } else if (!wasDismissed) {
          dismissToast(toastId);
        }
      }
      activeJobId.current = null;
      return;
    }

    const jobId = snapshot?.jobId ?? toastId;
    activeJobId.current = jobId;
    if (dismissedJobId.current === jobId) {
      return;
    }
    const current = findCurrentComponent(progress.components);
    const currentAgent = current?.agent ?? snapshot?.currentAgent ?? null;
    const currentAgentLabel = currentAgent ? getAgentDisplayLabel(currentAgent) : "agent tools";
    const phase = current?.phase ?? "queued";
    const phaseVerb = PHASE_VERB[phase] ?? "Preparing";

    // Bytes appear ONLY in the downloading description, and only ever the
    // per-COMPONENT counters — the aggregate job total is unreliable across
    // components with unknown sizes, and this surface never needs one.
    // Wrapped `aria-hidden` so a byte tick never reaches the live region;
    // the title (the phase verb + agent name) is what announces, and it does
    // not change on a byte tick, only on a phase transition.
    const description = phase === "downloading"
      ? (
        <span aria-hidden="true">
          {formatDownloadedMegabytesLine(
            current?.downloadedBytes ?? 0,
            current?.downloadSizeBytes ?? null,
          )}
        </span>
      )
      : phase === "queued"
        ? "Waiting to download."
        : phase === "verifying"
          ? "Checking the download."
          : phase === "finalizing"
            ? "Wrapping up the install."
            : "Unpacking and installing.";

    // In-progress is an announcement-weight status, replaced in place per
    // phase (same toast id) rather than stacked — this used to be a
    // hand-authored card with its own frame, close button, and progress bar.
    showToast({
      id: toastId,
      weight: "announcement",
      badge: "AGENTS",
      title: `${phaseVerb} ${currentAgentLabel}`,
      description,
      // No advertised end: an install has no dwell to promise, and the
      // terminal branch above replaces this toast when the job resolves.
      duration: Number.POSITIVE_INFINITY,
      onDismiss: () => {
        dismissedJobId.current = jobId;
      },
    });
  }, [isActive, navigate, progress, snapshot, toastId]);
}

export function HarnessUpdateToastPresenter({
  includeCloud = true,
}: {
  includeCloud?: boolean;
}) {
  const localCatalog = useAgentCatalog();
  const { cloudActive } = useCloudAvailabilityState();

  useHarnessProgressToast({
    snapshot: localCatalog.reconcileSnapshot,
    toastId: HARNESS_UPDATE_TOAST_ID,
  });

  return includeCloud && cloudActive ? (
    <Suspense fallback={null}>
      <LazyCloudAnyHarnessRuntimeProvider>
        <CloudHarnessUpdateToast />
      </LazyCloudAnyHarnessRuntimeProvider>
    </Suspense>
  ) : null;
}

function CloudHarnessUpdateToast() {
  const cloudCatalog = useAgentCatalog();

  useHarnessProgressToast({
    snapshot: cloudCatalog.reconcileSnapshot,
    toastId: CLOUD_HARNESS_UPDATE_TOAST_ID,
  });

  return null;
}
