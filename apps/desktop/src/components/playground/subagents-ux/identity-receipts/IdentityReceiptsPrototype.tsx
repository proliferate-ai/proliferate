import { useMemo, useState } from "react";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { shortDelegatedWorkId } from "@/lib/domain/delegated-work/identity";
import { SubagentIdentityGlyph } from "./SubagentIdentityGlyph";
import {
  SubagentCreationReceipt,
  type ReceiptDensity,
  type SubagentReceiptModel,
} from "./SubagentCreationReceipt";

type GroupingMode = "single" | "grouped";
type WakeMode = "scheduled" | "none";

const WAKE_ITEMS = [
  { id: "scheduled", label: "Wake scheduled" },
  { id: "none", label: "No wake" },
] as const satisfies readonly { id: WakeMode; label: string }[];

const DENSITY_ITEMS = [
  { id: "compact", label: "Compact" },
  { id: "comfortable", label: "Comfortable" },
] as const satisfies readonly { id: ReceiptDensity; label: string }[];

const MODE_ITEMS = [
  { id: "single", label: "Single" },
  { id: "grouped", label: "Grouped" },
] as const satisfies readonly { id: GroupingMode; label: string }[];

// Task-derived titles mirroring the labels agents actually mint (slug-style
// tasks, display-cased for UI).
const GROUP_FIXTURES: { idSuffix: string; title: string; wake: boolean; prompt: string }[] = [
  { idSuffix: "api-surface", title: "API Surface Check", wake: true, prompt: "Check the public API for contract drift." },
  { idSuffix: "session-lifecycle", title: "Session Lifecycle Audit", wake: false, prompt: "Audit create, wake, and close behavior." },
  { idSuffix: "cloud-auth", title: "Cloud Auth Review", wake: false, prompt: "Review cloud authentication boundaries." },
  { idSuffix: "mcp-catalog", title: "MCP Catalog Probe", wake: false, prompt: "Compare advertised MCP tools with handlers." },
  { idSuffix: "ci-cd", title: "CI Pipeline Cleanup", wake: false, prompt: "Find redundant CI jobs and dependencies." },
];

export function IdentityReceiptsPrototype() {
  const [seed, setSeed] = useState("subagent_abc123");
  const [wakeMode, setWakeMode] = useState<WakeMode>("scheduled");
  const [density, setDensity] = useState<ReceiptDensity>("comfortable");
  const [mode, setMode] = useState<GroupingMode>("single");
  const [lastAction, setLastAction] = useState<string | null>(null);

  const normalizedSeed = seed.trim() || "subagent_abc123";

  const singleModel: SubagentReceiptModel = useMemo(
    () => ({
      subagentId: normalizedSeed,
      title: "API Surface Check",
      harnessLabel: "Claude",
      wakeScheduled: wakeMode === "scheduled",
      timestamp: "2026-07-11 14:02",
      prompt: "Inspect the public API surface for contract mismatches.",
    }),
    [normalizedSeed, wakeMode],
  );

  const groupedModels: SubagentReceiptModel[] = useMemo(
    () =>
      GROUP_FIXTURES.map((fixture) => ({
        subagentId: `${normalizedSeed}-${fixture.idSuffix}`,
        title: fixture.title,
        harnessLabel: "Claude",
        wakeScheduled: fixture.wake,
        timestamp: "2026-07-11 14:02",
        prompt: fixture.prompt,
      })),
    [normalizedSeed],
  );

  const neighborSeeds = useMemo(
    () => Array.from({ length: 12 }, (_, index) => `${normalizedSeed}-${index}`),
    [normalizedSeed],
  );

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Identity + creation receipts
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-56">
            <Label htmlFor="identity-seed-input">Identity seed (subagent ID)</Label>
            <Input
              id="identity-seed-input"
              value={seed}
              placeholder="subagent_abc123"
              onChange={(event) => setSeed(event.target.value)}
            />
          </div>
          <div>
            <Label>Launch receipt</Label>
            <SegmentedControl
              items={WAKE_ITEMS}
              value={wakeMode}
              onChange={setWakeMode}
              ariaLabel="Wake scheduling recorded by the receipt"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label>Density</Label>
            <SegmentedControl
              items={DENSITY_ITEMS}
              value={density}
              onChange={setDensity}
              ariaLabel="Receipt density"
            />
          </div>
          <div>
            <Label>Mode</Label>
            <SegmentedControl
              items={MODE_ITEMS}
              value={mode}
              onChange={setMode}
              ariaLabel="Single or grouped receipts"
            />
          </div>
        </div>
      </section>

      <section aria-label="Creation receipts" className="flex flex-col gap-2">
        {mode === "single" ? (
          <SubagentCreationReceipt
            model={singleModel}
            density={density}
            onOpenSession={(id) => setLastAction(`Open agent session: ${id}`)}
          />
        ) : (
          <div className={density === "compact" ? "flex flex-col gap-1" : "flex flex-col gap-1.5"}>
            {groupedModels.map((model) => (
              <SubagentCreationReceipt
                key={model.subagentId}
                model={model}
                density={density}
                onOpenSession={(id) => setLastAction(`Open agent session: ${id}`)}
              />
            ))}
          </div>
        )}
        <p aria-live="polite" className="min-h-4 text-xs text-faint">
          {lastAction ?? "Receipt actions land here."}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">
          Determinism check — glyphs for adjacent seeds
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {neighborSeeds.map((neighborSeed) => (
            <Tooltip
              key={neighborSeed}
              content={shortDelegatedWorkId(neighborSeed)}
              singleLine
            >
              <span className="flex size-8 items-center justify-center rounded-md bg-foreground/5">
                <SubagentIdentityGlyph seed={neighborSeed} size={20} />
              </span>
            </Tooltip>
          ))}
        </div>
        <p className="text-xs text-faint">
          Same seed always yields the same mark; the short ID stays hover-only.
          The agent-authored task label is the only human-readable name.
        </p>
      </section>
    </div>
  );
}
