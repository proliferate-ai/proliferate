import { Badge } from "@proliferate/ui/primitives/Badge";
import type { DirectRuntimeConnectionState } from "@/lib/domain/compute/direct-runtime";
import {
  directRuntimeAttachStateLabel,
  directRuntimeAttachStateTone,
  type DirectRuntimeAttachTone,
} from "@/lib/domain/compute/direct-runtime-presentation";

const DOT_TONE_CLASSES: Record<DirectRuntimeAttachTone, string> = {
  success: "text-success",
  info: "text-info",
  destructive: "text-destructive",
  neutral: "text-muted-foreground",
};

/**
 * Attach-state chip for direct runtimes (This Mac / ssh targets): the
 * desktop-plane parallel of the cloud status Badge, with attach semantics
 * instead of provisioning stages.
 */
export function DirectRuntimeAttachChip({
  state,
}: {
  state: DirectRuntimeConnectionState;
}) {
  return (
    <Badge tone={directRuntimeAttachStateTone(state)} className="gap-1.5">
      <AttachDotGlyph state={state} />
      {directRuntimeAttachStateLabel(state)}
    </Badge>
  );
}

/** Dot-only variant for dense rows (pickers, scope tabs, sidebar). */
export function DirectRuntimeAttachDot({
  state,
  className = "",
}: {
  state: DirectRuntimeConnectionState;
  className?: string;
}) {
  const label = directRuntimeAttachStateLabel(state);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center ${
        DOT_TONE_CLASSES[directRuntimeAttachStateTone(state)]
      } ${className}`}
    >
      <AttachDotGlyph state={state} />
    </span>
  );
}

function AttachDotGlyph({ state }: { state: DirectRuntimeConnectionState }) {
  return (
    <span
      aria-hidden="true"
      className={`size-1.5 rounded-full bg-current ${
        state === "connecting" ? "animate-pulse" : ""
      }`}
    />
  );
}
