import type { AgentInstallProgressComponent } from "@anyharness/sdk";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";
import {
  byteProgressPercent,
  formatByteProgress,
} from "#product/lib/domain/updates/byte-progress";

interface HarnessUpdateProgressProps {
  components: AgentInstallProgressComponent[];
  displayName: string;
  targetLabel: string;
}

const TERMINAL_PHASES = new Set(["completed", "skipped", "failed"]);

function roleLabel(displayName: string, role: string): string {
  return role === "native_cli"
    ? `${displayName} CLI`
    : `${displayName} ACP adapter`;
}

function phaseLabel(phase: AgentInstallProgressComponent["phase"]): string {
  switch (phase) {
    case "queued":
      return "Waiting";
    case "downloading":
      return "Downloading";
    case "verifying":
      return "Verifying";
    case "extracting":
      return "Extracting";
    case "installing":
      return "Installing package";
    case "finalizing":
      return "Finalizing";
    case "completed":
      return "Ready";
    case "skipped":
      return "Already current";
    case "failed":
      return "Failed";
    default:
      return "Working";
  }
}

function componentByteLabel(component: AgentInstallProgressComponent): string | null {
  const total = component.downloadSizeBytes ?? null;
  if (component.downloadedBytes > 0 || total !== null) {
    return formatByteProgress(component.downloadedBytes, total);
  }
  if (component.phase === "installing") {
    return "Download size unavailable";
  }
  return null;
}

export function HarnessUpdateProgress({
  components,
  displayName,
  targetLabel,
}: HarnessUpdateProgressProps) {
  const sorted = [...components].sort((left, right) =>
    left.role === right.role ? 0 : left.role === "native_cli" ? -1 : 1
  );
  const completed = sorted.filter((component) =>
    TERMINAL_PHASES.has(component.phase)
  ).length;
  const downloadedBytes = sorted.reduce(
    (sum, component) => sum + component.downloadedBytes,
    0,
  );
  const knownSizes = sorted.map((component) => component.downloadSizeBytes ?? null);
  const totalBytes = knownSizes.every((size) => size !== null)
    ? knownSizes.reduce<number>((sum, size) => sum + (size ?? 0), 0)
    : null;
  const aggregatePercent = byteProgressPercent(downloadedBytes, totalBytes);
  const aggregateLabel = downloadedBytes > 0 || totalBytes !== null
    ? formatByteProgress(downloadedBytes, totalBytes)
    : `${completed} of ${sorted.length} components`;

  return (
    <section
      aria-label={`${displayName} update progress`}
      className="space-y-3 rounded-lg border border-border bg-foreground/[0.02] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-ui font-medium text-foreground">
            Updating {displayName}
          </p>
          <p className="text-ui-sm text-muted-foreground">
            {targetLabel} · {aggregateLabel}
          </p>
        </div>
        <span className="shrink-0 text-ui-xs tabular-nums text-muted-foreground">
          {completed}/{sorted.length}
        </span>
      </div>

      {aggregatePercent !== null ? (
        <ProgressBar
          aria-label={`${displayName} aggregate download progress`}
          aria-valuetext={aggregateLabel}
          value={aggregatePercent}
          className="h-1 w-full overflow-hidden rounded-full bg-accent"
          indicatorClassName="h-full rounded-full bg-special transition-[width] duration-300"
        />
      ) : null}

      <div className="divide-y divide-border">
        {sorted.map((component) => {
          const byteLabel = componentByteLabel(component);
          const percent = byteProgressPercent(
            component.downloadedBytes,
            component.downloadSizeBytes ?? null,
          );
          const label = roleLabel(displayName, component.role);
          return (
            <div key={`${component.agent}:${component.role}`} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ui-sm font-medium text-foreground">{label}</span>
                <span className="text-ui-xs text-muted-foreground">
                  {phaseLabel(component.phase)}
                </span>
              </div>
              {byteLabel ? (
                <p className="mt-0.5 text-ui-xs tabular-nums text-muted-foreground">
                  {byteLabel}
                </p>
              ) : null}
              {percent !== null && !TERMINAL_PHASES.has(component.phase) ? (
                <ProgressBar
                  aria-label={`${label} download progress`}
                  aria-valuetext={byteLabel ?? undefined}
                  value={percent}
                  className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-accent"
                  indicatorClassName="h-full rounded-full bg-special transition-[width] duration-300"
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
