import { useMemo, useState } from "react";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { SegmentedControl } from "#product/primitives/SegmentedControl";
import { Tooltip } from "#product/primitives/Tooltip";
import { shortDelegatedWorkId } from "#product/lib/domain/delegated-work/identity";
import { SubagentIdentityGlyph } from "#product/components/playground/subagents-ux/identity-receipts/SubagentIdentityGlyph";
import {
  SubagentCreationReceipt,
  type ReceiptDensity,
  type SubagentReceiptModel,
} from "#product/components/playground/subagents-ux/identity-receipts/SubagentCreationReceipt";

type GroupingMode = "single" | "grouped";
type WakeMode = "scheduled" | "none";

const IDENTITY_PROOF_SIZES = [12, 16, 18, 20] as const;

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
  const [seed, setSeed] = useState("session_abc123");
  const [wakeMode, setWakeMode] = useState<WakeMode>("scheduled");
  const [density, setDensity] = useState<ReceiptDensity>("comfortable");
  const [mode, setMode] = useState<GroupingMode>("single");
  const [lastAction, setLastAction] = useState<string | null>(null);

  const normalizedSeed = seed.trim() || "session_abc123";

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
        <h2 className="text-heading font-semibold text-muted-foreground">
          Identity + creation receipts
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-56">
            <Label htmlFor="identity-seed-input">Identity seed (durable session ID)</Label>
            <Input
              id="identity-seed-input"
              value={seed}
              placeholder="session_abc123"
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
        <p aria-live="polite" className="min-h-4 text-ui-sm text-faint">
          {lastAction ?? "Receipt actions land here."}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-heading font-semibold text-muted-foreground">
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
                <SubagentIdentityGlyph seed={neighborSeed} className="text-ui icon-large" />
              </span>
            </Tooltip>
          ))}
        </div>
        <p className="text-ui-sm text-faint">
          Same seed always yields the same mark; the short ID stays hover-only.
          The agent-authored task label is the only human-readable name.
        </p>
      </section>

      <section
        aria-label="UI-R01 identity scale and Closed-state proof"
        className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3"
        data-ui-r01-identity-proof
      >
        <h3 className="text-heading font-semibold text-muted-foreground">
          UI-R01 · one durable identity
        </h3>
        <div className="flex flex-wrap items-end gap-5">
          {IDENTITY_PROOF_SIZES.map((size) => (
            <div key={size} className="flex flex-col items-center gap-1.5">
              <span className="flex size-7 items-center justify-center">
                <SubagentIdentityGlyph
                  seed={normalizedSeed}
                  dimension={size}
                  label={`${size}px Solid Seal`}
                />
              </span>
              <span className="font-mono text-ui-sm text-faint">{size}px</span>
            </div>
          ))}
          <div className="h-8 w-px bg-border" aria-hidden="true" />
          <div className="flex flex-col items-center gap-1.5">
            <span className="flex size-7 items-center justify-center">
              <SubagentIdentityGlyph
                seed={normalizedSeed}
                dimension={20}
                dimmed
                label="Closed Solid Seal"
              />
            </span>
            <span className="font-mono text-ui-sm text-faint">Closed</span>
          </div>
        </div>
        <p className="text-ui-sm text-faint">
          Shape, notch, and color come from the durable session ID. Size and Closed
          opacity are presentation only.
        </p>
      </section>
    </div>
  );
}
