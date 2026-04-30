import type { ComponentType } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  ArrowUp,
  Check,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  type IconProps,
} from "@/components/ui/icons";
import {
  UPDATE_PREVIEW_STATES,
  type UpdatePreviewPhase,
  type UpdatePreviewState,
} from "@/config/update-playground";

const PHASE_LABELS: Record<UpdatePreviewPhase, string> = {
  checking: "Checking",
  available: "Available",
  downloading: "Downloading",
  ready: "Ready",
  error: "Error",
};

const PHASE_ICONS: Record<UpdatePreviewPhase, ComponentType<IconProps>> = {
  checking: RefreshCw,
  available: ArrowUp,
  downloading: LoaderCircle,
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

const PHASE_BADGE_CLASSNAMES: Record<UpdatePreviewPhase, string> = {
  checking: "border-border/50 bg-muted/50 text-muted-foreground",
  available: "border-border/60 bg-foreground/5 text-foreground",
  downloading: "border-border/50 bg-muted/50 text-muted-foreground",
  ready: "border-success/30 bg-success/10 text-success",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function UpdateUiPlayground() {
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
          <Icon className={`size-4 ${isBusy ? "animate-spin" : ""}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium">{state.title}</p>
            <Badge className={PHASE_BADGE_CLASSNAMES[state.phase]}>
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
            <Icon className={`size-5 ${isBusy ? "animate-spin" : ""}`} />
          </div>
          <Badge className={PHASE_BADGE_CLASSNAMES[state.phase]}>
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
