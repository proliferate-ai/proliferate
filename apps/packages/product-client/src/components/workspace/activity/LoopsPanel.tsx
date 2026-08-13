import { useState } from "react";
import { Plus, Trash } from "#product/primitives/icons/core";
import { RotateCw } from "#product/primitives/icons/status";
import {
  humanizeLoopCadence,
  loopNextFireAtMs,
  relativeFutureTimeLabel,
  sortLoopsForDisplay,
  type LoopCapabilities,
  type LoopScheduleKind,
  type LoopWire,
} from "#product/domain/activity/loop";
import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { IconButton } from "#product/primitives/IconButton";
import { Input } from "#product/primitives/Input";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { SegmentedControl, type SegmentedControlItem } from "#product/primitives/SegmentedControl";
import { Textarea } from "#product/primitives/Textarea";
import { Card } from "#product/primitives/patterns/Card";
import { RosterPanel } from "#product/primitives/patterns/RosterPanel";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { twMerge } from "#product/primitives/utils/tw-merge";
import type { LoopArmInput } from "#product/lib/domain/activity/loop-arm-input";

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
    <RosterPanel
      title="Loops"
      data-loops-panel
      headerAction={!composing && (
        <IconButton
          size="xs"
          title="Arm a new loop"
          aria-label="Arm a new loop"
          disabled={!capabilities.supported || pendingWrite}
          onClick={() => setComposing(true)}
        >
          <Plus className="icon-paired" />
        </IconButton>
      )}
      empty={
        // The composer replaces the empty line while it is open: an
        // armed-loop count of zero is not an empty roster when the caller is
        // already mid-arm.
        composing ? null : "No loops armed."
      }
      footer={composing && capabilities.supported && (
        <LoopComposer
          pendingWrite={pendingWrite}
          onCancel={() => setComposing(false)}
          onArm={(input) => {
            onArm(input);
            setComposing(false);
          }}
        />
      )}
    >
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
    </RosterPanel>
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
    <li>
      <RosterRow
        className={cleared ? "opacity-60" : undefined}
        leading={(
          <RotateCw
            className={twMerge("icon-paired", cleared ? "text-faint" : "text-muted-foreground")}
            aria-hidden
          />
        )}
        title={<span data-telemetry-mask className="line-clamp-2">{loop.prompt}</span>}
        secondary={(
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
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
              <Button
                variant="unstyled"
                size="unstyled"
                type="button"
                className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                onClick={() => onOpenFireHistory(loop.loopId)}
              >
                {fireCountLabel}
              </Button>
            ) : (
              <span>{fireCountLabel}</span>
            )}
            <Badge
              size="micro"
              tone={loop.native ? "neutral" : "warning"}
              className="uppercase tracking-wide"
            >
              {loop.native ? "native" : "emulated"}
            </Badge>
          </span>
        )}
        actions={!cleared ? (
          <RowActionIconButton
            label={`Delete loop: ${loop.prompt}`}
            visibility="always"
            disabled={pendingWrite}
            onClick={() => onDelete(loop.loopId)}
          >
            <Trash className="icon-paired" />
          </RowActionIconButton>
        ) : null}
      />
    </li>
  );
}

const SCHEDULE_KIND_OPTIONS: { value: LoopScheduleKind; label: string; placeholder: string }[] = [
  { value: "interval", label: "Interval", placeholder: "5m" },
  { value: "cron", label: "Cron", placeholder: "*/5 * * * *" },
];

const SEGMENTED_SCHEDULE_KIND_ITEMS: SegmentedControlItem<LoopScheduleKind>[] = SCHEDULE_KIND_OPTIONS.map(
  (option) => ({ id: option.value, label: option.label }),
);

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
    <Card
      as="section"
      surface="opaque"
      className="p-1.5"
    >
      <form
        className="flex flex-col gap-1.5"
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
          className="text-ui"
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="flex items-center gap-1.5">
          <SegmentedControl
            items={SEGMENTED_SCHEDULE_KIND_ITEMS}
            value={kind}
            ariaLabel="Loop schedule kind"
            onChange={(nextKind) => {
              const option = SCHEDULE_KIND_OPTIONS.find((candidate) => candidate.value === nextKind)!;
              setKind(nextKind);
              setExpr(option.placeholder);
            }}
          />
          <Input
            value={expr}
            aria-label="Loop cadence"
            placeholder={activeOption.placeholder}
            className="h-7 min-w-0 flex-1 text-ui"
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
    </Card>
  );
}
