import { useEffect, useState, type ComponentType } from "react";
import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";
import {
  ArrowUp,
  Check,
  CircleAlert,
  Spinner,
} from "@proliferate/ui/icons";
import {
  UPDATE_PREVIEW_STATES,
  type UpdatePreviewPhase,
  type UpdatePreviewState,
} from "@/config/update-playground";
import { UpdateDialogContent } from "@/components/feedback/UpdateDialogContent";
import { SidebarUpdatePill } from "@/components/workspace/shell/sidebar/SidebarUpdatePill";
import { useToastStore } from "@/stores/toast/toast-store";
import { setDevRunningAgentCount } from "@/hooks/app/lifecycle/use-running-agent-count";

type ProductionSurfacePreview =
  | "available"
  | "downloading"
  | "ready-reminder"
  | "restart-dialog";

interface DevUpdaterMockState {
  phase: "available" | "downloading" | "ready";
  version: string;
  downloadProgress: number | null;
  restartPromptOpen: boolean;
  lastCheckedAt: string | null;
  errorMessage: string | null;
}

const DEV_UPDATER_MOCK_KEY = "proliferate.dev.updaterMock";
const DEV_UPDATER_MOCK_EVENT = "proliferate:dev-updater-mock";
const PREVIEW_VERSION = "0.1.42";
const PRODUCTION_SURFACE_PREVIEWS: {
  id: ProductionSurfacePreview;
  label: string;
}[] = [
  { id: "available", label: "Available" },
  { id: "downloading", label: "Downloading" },
  { id: "ready-reminder", label: "Ready reminder" },
  { id: "restart-dialog", label: "Restart dialog" },
];

const PHASE_LABELS: Record<UpdatePreviewPhase, string> = {
  checking: "Checking",
  available: "Available",
  downloading: "Downloading",
  ready: "Ready",
  error: "Error",
};

const PHASE_ICONS: Record<UpdatePreviewPhase, ComponentType<{ className?: string }>> = {
  checking: Spinner,
  available: ArrowUp,
  downloading: Spinner,
  ready: Check,
  error: CircleAlert,
};

const PHASE_ICON_CLASSNAMES: Record<UpdatePreviewPhase, string> = {
  checking: "text-muted-foreground",
  available: "text-foreground",
  downloading: "text-muted-foreground",
  ready: "text-success",
  error: "text-destructive",
};

const PHASE_BADGE_TONES: Record<UpdatePreviewPhase, BadgeTone> = {
  checking: "neutral",
  available: "accent",
  downloading: "neutral",
  ready: "success",
  error: "destructive",
};

export function UpdateUiPlayground() {
  const [productionSurfacePreview, setProductionSurfacePreview] =
    useState<ProductionSurfacePreview>("available");
  const [sparkleAutoUpdate, setSparkleAutoUpdate] = useState(true);
  const [mockSessionCount, setMockSessionCount] = useState(0);

  useEffect(() => {
    return () => {
      setDevRunningAgentCount(null);
    };
  }, []);

  useEffect(() => {
    writeDevUpdaterMock(buildProductionSurfaceMock(productionSurfacePreview));
    return () => {
      clearDevUpdaterMock();
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
          title="Smart restart confirm (proposal)"
          description="Opens when you click Update / Restart. It only becomes a real decision when local sessions are running — and offers to defer the restart until they finish instead of forcing it. With nothing running it collapses to a one-tap restart (or skips the confirm entirely)."
        >
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-[420px] rounded-lg border border-border/80 bg-card p-5 shadow-floating-dark">
              <h3 className="text-lg font-medium tracking-tight text-foreground">
                Restart to finish updating
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Proliferate {PREVIEW_VERSION} is installed.{" "}
                <span className="text-foreground">3 sessions are running</span> — restarting will stop them.
              </p>
              <div className="mt-5 flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm">Later</Button>
                <Button variant="secondary" size="sm">Restart now</Button>
                <Button variant="primary" size="sm">Restart when they finish</Button>
              </div>
            </div>

            <div className="w-[420px] rounded-lg border border-border/80 bg-card p-5 shadow-floating-dark">
              <h3 className="text-lg font-medium tracking-tight text-foreground">
                Restart to finish updating
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Proliferate {PREVIEW_VERSION} is installed and ready.
              </p>
              <div className="mt-5 flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm">Later</Button>
                <Button variant="primary" size="sm">Restart now</Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground/70">
                0 sessions running — no warning needed; could skip the confirm and restart directly.
              </p>
            </div>
          </div>
        </PreviewSection>

        <PreviewSection
          title="Production Surfaces"
          description="Live updater components driven by the dev updater mock. The toast renders in the app toast position; the restart dialog renders as the real app modal. Use “+ standard toast” to drop a real app toast beside the update toast and confirm they match."
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
        </PreviewSection>

        <PreviewSection
          title="Variant A: Workspace Banner"
          description="A compact global surface for active workspaces. It should tell the user enough without stealing the main task."
        >
          <div className="grid gap-3">
            {UPDATE_PREVIEW_STATES.map((state) => (
              <UpdateWorkspaceBanner key={state.id} state={state} />
            ))}
          </div>
        </PreviewSection>

        <PreviewSection
          title="Variant B: Settings Status Card"
          description="A fuller settings surface where the state machine can expose last check, current version, progress, and errors."
        >
          <div className="grid gap-3 md:grid-cols-2">
            {UPDATE_PREVIEW_STATES.map((state) => (
              <UpdateSettingsStatusCard key={state.id} state={state} />
            ))}
          </div>
        </PreviewSection>
      </main>
    </div>
  );
}

function buildProductionSurfaceMock(preview: ProductionSurfacePreview): DevUpdaterMockState {
  const baseState = {
    version: PREVIEW_VERSION,
    lastCheckedAt: new Date().toISOString(),
    errorMessage: null,
  };

  if (preview === "downloading") {
    return {
      ...baseState,
      phase: "downloading",
      downloadProgress: 68,
      restartPromptOpen: false,
    };
  }

  if (preview === "ready-reminder") {
    return {
      ...baseState,
      phase: "ready",
      downloadProgress: null,
      restartPromptOpen: false,
    };
  }

  if (preview === "restart-dialog") {
    return {
      ...baseState,
      phase: "ready",
      downloadProgress: null,
      restartPromptOpen: true,
    };
  }

  return {
    ...baseState,
    phase: "available",
    downloadProgress: null,
    restartPromptOpen: false,
  };
}

function writeDevUpdaterMock(state: DevUpdaterMockState): void {
  window.localStorage.setItem(DEV_UPDATER_MOCK_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(DEV_UPDATER_MOCK_EVENT));
}

function clearDevUpdaterMock(): void {
  window.localStorage.removeItem(DEV_UPDATER_MOCK_KEY);
  window.dispatchEvent(new Event(DEV_UPDATER_MOCK_EVENT));
}

function PreviewSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
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

function UpdateWorkspaceBanner({ state }: { state: UpdatePreviewState }) {
  const Icon = PHASE_ICONS[state.phase];
  const isBusy = state.phase === "checking" || state.phase === "downloading";
  const primaryDisabled = isBusy;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/70 shadow-sm">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5 ${PHASE_ICON_CLASSNAMES[state.phase]}`}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium">{state.title}</p>
            <Badge tone={PHASE_BADGE_TONES[state.phase]}>
              {PHASE_LABELS[state.phase]}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {state.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state.secondaryAction && (
            <Button variant="ghost" size="sm" className="px-2.5">
              {state.secondaryAction}
            </Button>
          )}
          <Button
            variant={state.phase === "ready" ? "primary" : "secondary"}
            size="sm"
            disabled={primaryDisabled}
            className="px-2.5"
          >
            {state.primaryAction}
          </Button>
        </div>
      </div>
      {state.phase === "downloading" && state.progress !== null && (
        <ProgressBar
          value={state.progress}
          className="h-1 bg-muted"
          indicatorClassName="h-full bg-foreground transition-[width]"
        />
      )}
    </div>
  );
}

function UpdateSettingsStatusCard({ state }: { state: UpdatePreviewState }) {
  const Icon = PHASE_ICONS[state.phase];
  const isBusy = state.phase === "checking" || state.phase === "downloading";
  const primaryDisabled = isBusy;

  return (
    <article className="flex min-h-48 flex-col justify-between gap-5 rounded-lg border border-border bg-card/60 p-4">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground/5 ${PHASE_ICON_CLASSNAMES[state.phase]}`}
          >
            <Icon className="size-5" />
          </div>
          <Badge tone={PHASE_BADGE_TONES[state.phase]}>
            {PHASE_LABELS[state.phase]}
          </Badge>
        </div>

        <div className="space-y-1">
          <h3 className="text-base font-medium">{state.title}</h3>
          <p className="text-sm text-muted-foreground">{state.description}</p>
          <p className="text-xs text-muted-foreground/80">{state.detail}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <StatusDatum label="Current" value={`v${state.currentVersion}`} />
          <StatusDatum label="Latest" value={state.version ? `v${state.version}` : "Unknown"} />
          <StatusDatum label="Last check" value={state.checkedAt ?? "In progress"} />
          <StatusDatum
            label="State"
            value={state.phase === "downloading" && state.progress !== null
              ? `${state.progress}%`
              : PHASE_LABELS[state.phase]}
          />
        </div>

        {state.phase === "downloading" && state.progress !== null && (
          <ProgressBar
            value={state.progress}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            indicatorClassName="h-full rounded-full bg-foreground transition-[width]"
          />
        )}
      </div>

      <div className="flex justify-end gap-2">
        {state.secondaryAction && (
          <Button variant="ghost" size="sm">
            {state.secondaryAction}
          </Button>
        )}
        <Button
          variant={state.phase === "ready" ? "primary" : "secondary"}
          size="sm"
          disabled={primaryDisabled}
        >
          {state.primaryAction}
        </Button>
      </div>
    </article>
  );
}

function StatusDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-foreground/5 px-2.5 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}
