import type { ReactNode } from "react";
import { ComposerPopoverSurface, LoopsPanel } from "@proliferate/ui";

const noop = () => {};

// The capture harness pins the clock to 2024-05-15T12:00:00Z, and the panel
// takes `nowMs` from its caller — so pinning the same value keeps every
// "next in …" label deterministic across captures.
const NOW_MS = Date.parse("2024-05-15T12:00:00Z");
const MINUTE = 60_000;

const CAPABILITIES = { supported: true, native: true };

const HANDLERS = { onArm: noop, onDelete: noop };

const LOOPS = [
  {
    loopId: "loop_2f1c",
    prompt: "Re-run the transcript virtualization suite and post the diff of new failures.",
    schedule: { kind: "interval" as const, expr: "15m" },
    recurring: true,
    status: "active" as const,
    native: true,
    lastFiredAtMs: NOW_MS - 11 * MINUTE,
    fireCount: 7,
    updatedAtMs: NOW_MS - 96 * MINUTE,
  },
  {
    loopId: "loop_98ba",
    prompt: "Check whether proliferate-ai/proliferate#805 has new review comments.",
    schedule: { kind: "cron" as const, expr: "0 */2 * * *" },
    recurring: true,
    status: "active" as const,
    native: true,
    lastFiredAtMs: NOW_MS - 74 * MINUTE,
    fireCount: 3,
    updatedAtMs: NOW_MS - 300 * MINUTE,
  },
  {
    loopId: "loop_41d7",
    prompt: "Rebase claude/design-sync-ui-import onto main and report conflicts.",
    schedule: { kind: "interval" as const, expr: "6h" },
    recurring: true,
    status: "cleared" as const,
    native: true,
    lastFiredAtMs: NOW_MS - 400 * MINUTE,
    fireCount: 1,
    updatedAtMs: NOW_MS - 380 * MINUTE,
  },
];

// The panel is the ⟳ chip's click-in content, so it renders inside the same
// composer popover surface the chip opens.
const Surface = ({ children }: { children: ReactNode }) => (
  <ComposerPopoverSurface className="w-96 p-1.5">{children}</ComposerPopoverSurface>
);

export const ArmedLoops = () => (
  <Surface>
    <LoopsPanel
      loops={LOOPS}
      capabilities={CAPABILITIES}
      nowMs={NOW_MS}
      onOpenFireHistory={noop}
      {...HANDLERS}
    />
  </Surface>
);

export const ArmANewLoop = () => (
  <Surface>
    <LoopsPanel loops={[]} capabilities={CAPABILITIES} nowMs={NOW_MS} {...HANDLERS} />
  </Surface>
);

export const PendingWrite = () => (
  <Surface>
    <LoopsPanel
      loops={LOOPS.slice(0, 2)}
      capabilities={CAPABILITIES}
      nowMs={NOW_MS}
      pendingWrite
      {...HANDLERS}
    />
  </Surface>
);
