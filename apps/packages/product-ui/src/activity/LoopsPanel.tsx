import { useState } from "react";
import { Plus, RotateCw, Trash2 } from "lucide-react";
import {
  humanizeLoopCadence,
  loopNextFireAtMs,
  relativeFutureTimeLabel,
  sortLoopsForDisplay,
  type LoopCapabilities,
  type LoopSchedule,
  type LoopScheduleKind,
  type LoopWire,
} from "@proliferate/product-domain/activity/loop";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Input } from "@proliferate/ui/primitives/Input";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

export interface LoopArmInput {
  prompt: string;
  schedule: LoopSchedule;
  recurring: boolean;
}

export interface LoopsPanelProps {
  loops: LoopWire[];
  capabilities: LoopCapabilities;
  /** Caller owns the tick so a mounted panel can stay live without its own timer. */
  nowMs: number;
  onArm: (input: LoopArmInput) => void;
  onDelete: (loopId: string) => void;
  /** A mutation is in flight awaiting the native round-trip. */
  pendingWrite?: boolean;
  /** "N fires" becomes a link to the fired turns when provided. */
  onOpenFireHistory?: (loopId: string) => void;
}

/**
 * The ⟳ chip's click-in panel: armed loops (prompt, cadence, next fire, fire
 * count) plus a composer to arm a new one. Loops are strict mirrors where
 * native (Claude session crons) and runtime-emulated where not (Codex,
 * `native: false`) — the native/emulated badge makes that distinction
 * visible, never a harness name.
 */
export function LoopsPanel({
  loops,
  capabilities,
  nowMs,
  onArm,
  onDelete,
  pendingWrite = false,
  onOpenFireHistory,
}: LoopsPanelProps) {
  const [composing, setComposing] = useState(loops.length === 0);
  const sorted = sortLoopsForDisplay(loops);

  return (
    <div className="flex flex-col gap-1.5" data-loops-panel>
      <div className="flex items-center justify-between px-1 pt-0.5">
        <span className="text-xs font-medium text-foreground">Loops</span>
        {!composing && (
          <IconButton
            size="xs"
            title="Arm a new loop"
            aria-label="Arm a new loop"
            disabled={!capabilities.supported || pendingWrite}
            onClick={() => setComposing(true)}
          >
            <Plus className="size-3.5" />
          </IconButton>
        )}
      </div>

      {sorted.length === 0 && !composing && (
        <p className="px-1 pb-1 text-xs text-muted-foreground">No loops armed.</p>
      )}

      {sorted.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {sorted.map((loop) => (
            <LoopRow
              key={loop.loopId}
              loop={loop}
              nowMs={nowMs}
              onDelete={onDelete}
              pendingWrite={pendingWrite}
              onOpenFireHistory={onOpenFireHistory}
            />
          ))}
        </ul>
      )}

      {composing && capabilities.supported && (
        <LoopComposer
          pendingWrite={pendingWrite}
          onCancel={() => setComposing(false)}
          onArm={(input) => {
            onArm(input);
            setComposing(false);
          }}
        />
      )}
    </div>
  );
}

function LoopRow({
  loop,
  nowMs,
  onDelete,
  pendingWrite,
  onOpenFireHistory,
}: {
  loop: LoopWire;
  nowMs: number;
  onDelete: (loopId: string) => void;
  pendingWrite: boolean;
  onOpenFireHistory?: (loopId: string) => void;
}) {
  const nextFireAtMs = loopNextFireAtMs(loop, nowMs);
  const cleared = loop.status === "cleared";
  const fireCountLabel = `${loop.fireCount} fire${loop.fireCount === 1 ? "" : "s"}`;

  return (
    <li
      className={twMerge(
        "flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted/40",
        cleared && "opacity-60",
      )}
    >
      <RotateCw
        className={twMerge("mt-0.5 size-3.5 shrink-0", cleared ? "text-faint" : "text-muted-foreground")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs text-foreground" data-telemetry-mask>
          {loop.prompt}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span>{humanizeLoopCadence(loop.schedule)}</span>
          <span aria-hidden>·</span>
          <span>
            {cleared
              ? "cleared"
              : nextFireAtMs
                ? `next ${relativeFutureTimeLabel(nextFireAtMs, nowMs)}`
                : "no schedule"}
          </span>
          <span aria-hidden>·</span>
          {onOpenFireHistory && loop.fireCount > 0 ? (
            <button
              type="button"
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              onClick={() => onOpenFireHistory(loop.loopId)}
            >
              {fireCountLabel}
            </button>
          ) : (
            <span>{fireCountLabel}</span>
          )}
          <span
            className={twMerge(
              "rounded px-1 py-0.5 text-sm font-medium uppercase tracking-wide",
              loop.native ? "bg-muted text-muted-foreground" : "bg-warning/15 text-warning",
            )}
          >
            {loop.native ? "native" : "emulated"}
          </span>
        </div>
      </div>
      {!cleared && (
        <IconButton
          size="xs"
          title="Delete loop"
          aria-label={`Delete loop: ${loop.prompt}`}
          disabled={pendingWrite}
          onClick={() => onDelete(loop.loopId)}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      )}
    </li>
  );
}

const SCHEDULE_KIND_OPTIONS: { value: LoopScheduleKind; label: string; placeholder: string }[] = [
  { value: "interval", label: "Interval", placeholder: "5m" },
  { value: "cron", label: "Cron", placeholder: "*/5 * * * *" },
];

function LoopComposer({
  pendingWrite,
  onArm,
  onCancel,
}: {
  pendingWrite: boolean;
  onArm: (input: LoopArmInput) => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<LoopScheduleKind>("interval");
  const [expr, setExpr] = useState("5m");

  const activeOption = SCHEDULE_KIND_OPTIONS.find((option) => option.value === kind)!;
  const canArm = prompt.trim().length > 0 && expr.trim().length > 0;

  return (
    <form
      className="flex flex-col gap-1.5 rounded-md border border-border p-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canArm) {
          return;
        }
        onArm({
          prompt: prompt.trim(),
          schedule: { kind, expr: expr.trim() },
          recurring: true,
        });
      }}
    >
      <Textarea
        autoFocus
        rows={2}
        placeholder="What should this loop do on each fire?"
        value={prompt}
        aria-label="Loop prompt"
        data-telemetry-mask
        className="text-xs"
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="flex items-center gap-1.5">
        <div className="flex shrink-0 rounded-md border border-input p-0.5">
          {SCHEDULE_KIND_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={twMerge(
                "rounded px-1.5 py-0.5 text-xs",
                option.value === kind
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setKind(option.value);
                setExpr(option.placeholder);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Input
          value={expr}
          aria-label="Loop cadence"
          placeholder={activeOption.placeholder}
          className="h-7 min-w-0 flex-1 text-xs"
          onChange={(event) => setExpr(event.target.value)}
        />
      </div>
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canArm || pendingWrite}>
          Arm loop
        </Button>
      </div>
    </form>
  );
}
