import { type ComponentType } from "react";
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

export function UpdateWorkspaceBanner({ state }: { state: UpdatePreviewState }) {
  const Icon = PHASE_ICONS[state.phase];
  const primaryDisabled = state.phase === "checking" || state.phase === "downloading";

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

export function UpdateSettingsStatusCard({ state }: { state: UpdatePreviewState }) {
  const Icon = PHASE_ICONS[state.phase];
  const primaryDisabled = state.phase === "checking" || state.phase === "downloading";

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
