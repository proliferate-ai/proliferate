import { useEffect, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Label } from "@proliferate/ui/primitives/Label";
import { RangeSlider } from "@proliferate/ui/primitives/RangeSlider";
import { useToastStore } from "@/stores/toast/toast-store";
import { setDevRunningAgentCount } from "@/hooks/app/lifecycle/use-running-agent-count";
import { useUpdater, type UpdaterErrorSource } from "@/hooks/access/tauri/use-updater";
import {
  updateDevUpdaterMock,
  writeDevUpdaterMock,
  type DevUpdaterMockState,
} from "@/hooks/access/tauri/updater-dev-mock";
import { SidebarUpdatePill } from "@/components/workspace/shell/sidebar/SidebarUpdatePill";

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

/**
 * The "Production Surfaces" control strips + live pill readout: drives the
 * dev updater mock through every phase, error source, armed restart, session
 * count, and the download-progress scrubber.
 */
export function UpdateUiPlaygroundControls() {
  const [productionSurfacePreview, setProductionSurfacePreview] =
    useState<ProductionSurfacePreview>("available");
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
    <>
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
        <Label className="mb-0 flex items-center gap-2">
          Download progress
          <RangeSlider
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
            className="h-1 w-40"
          />
          <span className="w-8 text-right tabular-nums">
            {liveDownloadProgress ?? 0}%
          </span>
        </Label>
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
    </>
  );
}
