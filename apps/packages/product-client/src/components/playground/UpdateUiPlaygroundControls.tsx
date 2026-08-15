import { useEffect, useState } from "react";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { useToastStore } from "#product/stores/toast/toast-store";
import { setDevRunningAgentCount } from "#product/hooks/app/lifecycle/use-running-agent-count";
import { useUpdater } from "#product/hooks/access/tauri/use-updater";
import {
  updateDevUpdaterMock,
  writeDevUpdaterMock,
} from "#product/hooks/access/tauri/updater-dev-mock";
import { SidebarUpdateFooterButton } from "#product/components/app/sidebar/SidebarUpdateFooterButton";
import {
  buildProductionSurfaceMock,
  PREVIEW_DOWNLOAD_TOTAL_BYTES,
  PRODUCTION_SURFACE_PREVIEWS,
  setDevUpdaterMockErrorSource,
  type ProductionSurfacePreview,
} from "./update-ui-playground-mocks";

function LiveStateDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-ui">
      <div className="text-ui-sm text-muted-foreground">{label}</div>
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
    availableTitle: liveTitle,
    errorSource: liveErrorSource,
    downloadProgress: liveDownloadProgress,
    restartWhenIdle: liveRestartWhenIdle,
    manualCheckCompletedAt: liveManualCheckCompletedAt,
    checkNow,
    clearManualCheckCompleted,
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => useToastStore.getState().show("Couldn't save workspace", "error")}
        >
          + error toast
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <span className="text-ui-sm text-muted-foreground">Sessions running (mock):</span>
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
        <span className="text-ui-sm text-muted-foreground">Error source:</span>
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
          <Input
            type="range"
            variant="unstyled"
            className="h-1 w-40 cursor-pointer appearance-none rounded-full bg-input accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
                  ? {
                      ...current,
                      downloadProgress: next,
                      downloadReceivedBytes: Math.round(
                        (PREVIEW_DOWNLOAD_TOTAL_BYTES * next) / 100,
                      ),
                      downloadTotalBytes: PREVIEW_DOWNLOAD_TOTAL_BYTES,
                    }
                  : current,
              );
            }}
          />
          <span className="w-8 text-right tabular-nums">
            {liveDownloadProgress ?? 0}%
          </span>
        </Label>
      </div>

      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-card/60 p-3">
        <div className="flex min-h-6 items-center">
          <SidebarUpdateFooterButton />
          {livePhase !== "available"
            && livePhase !== "downloading"
            && livePhase !== "stalled"
            && livePhase !== "ready" && (
            <span className="text-ui-sm text-muted-foreground">
              No footer control for this phase
            </span>
          )}
        </div>
        <LiveStateDatum label="Phase" value={livePhase} />
        <LiveStateDatum label="Version" value={liveVersion ?? "—"} />
        <LiveStateDatum label="Title" value={liveTitle ?? "—"} />
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
