import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { UPDATE_PREVIEW_STATES } from "@/config/update-playground";
import { UpdateDialogContent } from "@/components/feedback/UpdateDialogContent";
import { SidebarUpdatePill } from "@/components/workspace/shell/sidebar/SidebarUpdatePill";
import { useToastStore } from "@/stores/toast/toast-store";
import { setDevRunningAgentCount } from "@/hooks/app/lifecycle/use-running-agent-count";
import { useUpdater, type UpdaterErrorSource } from "@/hooks/access/tauri/use-updater";
import {
  updateDevUpdaterMock,
  writeDevUpdaterMock,
  type DevUpdaterMockState,
} from "@/hooks/access/tauri/updater-dev-mock";

type ProductionSurfacePreview =
  | "available"
  | "downloading"
  | "ready-reminder"
  | "restart-dialog"
  | "ready-armed"
  | "manual-check-current"
  | "check-error"
  | "download-error";

const PREVIEW_VERSION = "0.1.42";
const CHECK_ERROR_MESSAGE = "Couldn't reach the update server.";
const DOWNLOAD_ERROR_MESSAGE = "Couldn't finish downloading the update.";
const PRODUCTION_SURFACE_PREVIEWS: {
  id: ProductionSurfacePreview;
  label: string;
}[] = [
  { id: "available", label: "Available" },
  { id: "downloading", label: "Downloading" },
  { id: "ready-reminder", label: "Ready reminder" },
  { id: "restart-dialog", label: "Restart dialog" },
  { id: "ready-armed", label: "Restart armed" },
  { id: "manual-check-current", label: "Up to date" },
  { id: "check-error", label: "Check failed" },
  { id: "download-error", label: "Download failed" },
];

export function UpdateUiPlayground() {
  const [productionSurfacePreview, setProductionSurfacePreview] =
    useState<ProductionSurfacePreview>("available");
  const [sparkleAutoUpdate, setSparkleAutoUpdate] = useState(true);
  const [mockSessionCount, setMockSessionCount] = useState(0);
  const {
    phase: livePhase,
    availableVersion: liveVersion,
    errorSource: liveErrorSource,
    downloadProgress: liveDownloadProgress,
    restartWhenIdle: liveRestartWhenIdle,
    manualCheckCompletedAt: liveManualCheckCompletedAt,
    checkNow,
    clearManualCheckCompleted,
    downloadUpdate,
    openRestartPrompt,
    scheduleRestartWhenIdle,
  } = useUpdater();

  useEffect(() => {
    return () => {
      setDevRunningAgentCount(null);
    };
  }, []);

  useEffect(() => {
    writeDevUpdaterMock(buildProductionSurfaceMock(productionSurfacePreview));
    return () => {
      writeDevUpdaterMock(null);
    };
  }, [productionSurfacePreview]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 px-7 py-5">
        <div className="mx-auto flex max-w-6xl items-end justify-between gap-6">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Dev preview
            </p>
            <h1 className="text-xl font-medium tracking-tight">
              Desktop Update UI
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Forced render of updater states without touching the real updater workflow.
            </p>
          </div>
          <Badge>import.meta.env.DEV</Badge>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-7 py-7">
        <PreviewSection
          title="Standalone Update Window"
          description="What the ?update=1 OS window would look like: its own window (mac chrome), mono-dark, version compare, auto-update opt-in, Install Update on our primary accent (not Sparkle blue). This is the exact UpdateDialogContent the real window will host."
        >
          <div className="flex justify-center rounded-xl border border-border/50 bg-background/40 px-6 py-12">
            <div className="w-[540px] overflow-hidden rounded-[12px] border border-border/70 bg-card shadow-floating-dark">
              <div className="flex items-center gap-2 px-4 pt-4">
                <span className="size-3 rounded-full bg-[#ff5f57]" />
                <span className="size-3 rounded-full bg-[#febc2e]" />
                <span className="size-3 rounded-full bg-foreground/20" />
              </div>
              <UpdateDialogContent
                availableVersion={PREVIEW_VERSION}
                currentVersion="0.1.41"
                autoUpdate={sparkleAutoUpdate}
                onToggleAutoUpdate={setSparkleAutoUpdate}
                onSkip={() => {}}
                onRemindLater={() => {}}
                onInstall={() => {}}
              />
            </div>
          </div>
        </PreviewSection>

        <PreviewSection
          title="Sidebar pill (top-left)"
          description="The header pill across phases. Actionable states (available, ready) sit on the primary accent; downloading is muted (not clickable) with a spinner."
        >
          <div className="flex flex-wrap items-end gap-8 rounded-lg border border-border bg-card/60 p-5">
            {(["available", "downloading", "ready"] as const).map((p) => (
              <div key={p} className="flex flex-col items-center gap-2">
                <SidebarUpdatePill
                  phase={p}
                  downloadProgress={p === "downloading" ? 68 : null}
                  onDownloadUpdate={() => {}}
                  onOpenRestartPrompt={() => {}}
                />
                <span className="text-xs text-muted-foreground">{p}</span>
              </div>
            ))}
          </div>
        </PreviewSection>

        <PreviewSection
          title="Production Surfaces"
          description="Live updater components driven by the dev updater mock. The toast renders in the app toast position; the restart dialog renders as the real app modal; the pill below is the real sidebar pill fed by the same mock. Use “+ standard toast” to drop a real app toast beside the update toast and confirm they match."
        >
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/60 p-3">
            {PRODUCTION_SURFACE_PREVIEWS.map((preview) => (
              <Button
                key={preview.id}
                variant={productionSurfacePreview === preview.id ? "primary" : "secondary"}
                size="sm"
                onClick={() => setProductionSurfacePreview(preview.id)}
              >
                {preview.label}
              </Button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => useToastStore.getState().show("Workspace saved", "info")}
            >
              + standard toast
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <span className="text-xs text-muted-foreground">Sessions running (mock):</span>
            {[0, 1, 3].map((count) => (
              <Button
                key={count}
                variant={mockSessionCount === count ? "primary" : "secondary"}
                size="sm"
                onClick={() => {
                  setMockSessionCount(count);
                  setDevRunningAgentCount(count);
                }}
              >
                {count}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/60 p-3">
            <Button variant="secondary" size="sm" onClick={() => void checkNow()}>
              Run manual check
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={liveManualCheckCompletedAt === null}
              onClick={clearManualCheckCompleted}
            >
              Clear up-to-date signal
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button
              variant={liveRestartWhenIdle ? "primary" : "secondary"}
              size="sm"
              disabled={livePhase !== "ready"}
              onClick={() => {
                if (liveRestartWhenIdle) {
                  updateDevUpdaterMock((current) =>
                    current ? { ...current, restartWhenIdle: false } : current,
                  );
                  return;
                }
                scheduleRestartWhenIdle();
              }}
            >
              {liveRestartWhenIdle ? "Disarm restart" : "Arm restart when idle"}
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <span className="text-xs text-muted-foreground">Error source:</span>
            {(["check", "download"] as const).map((source) => (
              <Button
                key={source}
                variant={liveErrorSource === source ? "primary" : "secondary"}
                size="sm"
                disabled={livePhase !== "error"}
                onClick={() => setDevUpdaterMockErrorSource(source)}
              >
                {source === "check" ? "Check" : "Download"}
              </Button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Download progress
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                aria-label="Download progress"
                value={liveDownloadProgress ?? 0}
                disabled={livePhase !== "downloading"}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  updateDevUpdaterMock((current) =>
                    current && current.phase === "downloading"
                      ? { ...current, downloadProgress: next }
                      : current,
                  );
                }}
                className="h-1 w-40 accent-foreground disabled:opacity-40"
              />
              <span className="w-8 text-right tabular-nums">
                {liveDownloadProgress ?? 0}%
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-card/60 p-3">
            <div className="flex min-h-6 items-center">
              <SidebarUpdatePill
                phase={livePhase}
                downloadProgress={liveDownloadProgress}
                restartWhenIdle={liveRestartWhenIdle}
                onDownloadUpdate={downloadUpdate}
                onOpenRestartPrompt={openRestartPrompt}
              />
              {livePhase !== "available" && livePhase !== "downloading" && livePhase !== "ready" && (
                <span className="text-xs text-muted-foreground">
                  No pill for this phase
                </span>
              )}
            </div>
            <LiveStateDatum label="Phase" value={livePhase} />
            <LiveStateDatum label="Version" value={liveVersion ?? "—"} />
            <LiveStateDatum label="Error source" value={liveErrorSource ?? "—"} />
            <LiveStateDatum
              label="Restart armed"
              value={liveRestartWhenIdle ? "yes" : "no"}
            />
            <LiveStateDatum
              label="Up-to-date signal"
              value={
                liveManualCheckCompletedAt === null
                  ? "—"
                  : new Date(liveManualCheckCompletedAt).toLocaleTimeString()
              }
            />
          </div>
        </PreviewSection>

        <PreviewSection
          title="Copy deck"
          description="Reference copy for each updater phase. The production surfaces (toast, pill, restart dialog, settings row) draw from these strings."
        >
          <div className="grid gap-3 md:grid-cols-2">
            {UPDATE_PREVIEW_STATES.map((state) => (
              <article
                key={state.id}
                className="rounded-lg border border-border bg-card/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-medium">{state.title}</h3>
                  <Badge>{state.phase}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{state.description}</p>
                <p className="mt-0.5 text-xs text-muted-foreground/80">{state.detail}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {state.primaryAction}
                  {state.secondaryAction ? ` · ${state.secondaryAction}` : ""}
                </p>
              </article>
            ))}
          </div>
        </PreviewSection>
      </main>
    </div>
  );
}

function setDevUpdaterMockErrorSource(source: UpdaterErrorSource): void {
  updateDevUpdaterMock((current) =>
    current && current.phase === "error"
      ? {
          ...current,
          errorSource: source,
          errorMessage:
            source === "check" ? CHECK_ERROR_MESSAGE : DOWNLOAD_ERROR_MESSAGE,
        }
      : current,
  );
}

function buildProductionSurfaceMock(preview: ProductionSurfacePreview): DevUpdaterMockState {
  const baseState = {
    version: PREVIEW_VERSION,
    downloadProgress: null,
    restartPromptOpen: false,
    restartWhenIdle: false,
    lastCheckedAt: new Date().toISOString(),
    errorMessage: null,
    errorSource: null,
    manualCheckCompletedAt: null,
  } satisfies Omit<DevUpdaterMockState, "phase">;

  if (preview === "downloading") {
    return {
      ...baseState,
      phase: "downloading",
      downloadProgress: 68,
    };
  }

  if (preview === "ready-reminder") {
    return {
      ...baseState,
      phase: "ready",
    };
  }

  if (preview === "restart-dialog") {
    return {
      ...baseState,
      phase: "ready",
      restartPromptOpen: true,
    };
  }

  if (preview === "ready-armed") {
    return {
      ...baseState,
      phase: "ready",
      restartWhenIdle: true,
    };
  }

  if (preview === "manual-check-current") {
    return {
      ...baseState,
      phase: "current",
      manualCheckCompletedAt: Date.now(),
    };
  }

  if (preview === "check-error") {
    return {
      ...baseState,
      phase: "error",
      errorMessage: CHECK_ERROR_MESSAGE,
      errorSource: "check",
    };
  }

  if (preview === "download-error") {
    return {
      ...baseState,
      phase: "error",
      errorMessage: DOWNLOAD_ERROR_MESSAGE,
      errorSource: "download",
    };
  }

  return {
    ...baseState,
    phase: "available",
  };
}

function LiveStateDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium text-foreground">{value}</div>
    </div>
  );
}

function PreviewSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
