import { useState, type CSSProperties, type ReactNode } from "react";
import { ChromeWorkspaceTab } from "@/components/workspace/shell/tabs/ChromeWorkspaceTab";
import {
  renderChatTabIcon,
  renderChatTabStatusBadge,
} from "@/components/workspace/shell/tabs/tab-rendering";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";

// Dev-only visual bench for the workspace session tab. Drives the REAL
// ChromeWorkspaceTab via its CSS custom properties so every knob below
// reflects exactly what shipping the value would look like. Route: /playground/tabs

type IconFixture = {
  agentKind: string;
  viewState: SessionViewState;
  delegatedAgent: null;
  isResolvingSession: boolean;
};

interface TabState {
  label: string;
  caption: string;
  agentKind: string;
  viewState: SessionViewState;
  isResolvingSession?: boolean;
  hasUnreadActivity?: boolean;
  isActive?: boolean;
  isMultiSelected?: boolean;
}

const STATES: TabState[] = [
  { label: "auth refactor", caption: "inactive", agentKind: "claude", viewState: "idle" },
  { label: "billing webhook", caption: "← selected tab", agentKind: "codex", viewState: "idle", isActive: true },
  { label: "migration script", caption: "working", agentKind: "claude", viewState: "working" },
  { label: "review comments", caption: "needs input", agentKind: "codex", viewState: "needs_input" },
  { label: "flaky e2e", caption: "errored", agentKind: "claude", viewState: "errored" },
  { label: "seed data", caption: "unread", agentKind: "gemini", viewState: "idle", hasUnreadActivity: true },
  { label: "perf pass", caption: "← multi-select", agentKind: "claude", viewState: "idle", isMultiSelected: true },
  { label: "loading…", caption: "resolving", agentKind: "claude", viewState: "idle", isResolvingSession: true },
];

const WIDTHS = [160, 120, 84, 60, 44];

type Tint = "foreground" | "accent" | "overlay";

interface Knobs {
  fillBase: Tint; // selected + active
  restBase: Tint; // inactive + hover
  inactivePct: number;
  hoverPct: number;
  activePct: number;
  selectedPct: number;
  borderPct: number;
  radius: number;
  gap: number;
  weight: number;
  underline: boolean;
  underlineColor: string;
  separators: boolean;
  showBadge: boolean;
}

const SHIPPING: Knobs = {
  fillBase: "foreground",
  restBase: "foreground",
  inactivePct: 0,
  hoverPct: 4,
  activePct: 8,
  selectedPct: 10,
  borderPct: 0,
  radius: 8,
  gap: 3,
  weight: 500,
  underline: false,
  underlineColor: "var(--color-border-highlight)",
  separators: false,
  showBadge: true,
};

// One-click looks for the active/selected treatment — the thing under debate.
const PRESETS: { name: string; hint: string; knobs: Knobs }[] = [
  {
    name: "Dark chip + soft rest",
    hint: "dark rounded selected, light hover rest",
    knobs: {
      ...SHIPPING,
      fillBase: "overlay",
      restBase: "foreground",
      inactivePct: 3,
      hoverPct: 9,
      activePct: 26,
      selectedPct: 34,
      borderPct: 12,
      radius: 10,
    },
  },
  {
    name: "Dark + rim",
    hint: "darker than bar, subtle border",
    knobs: { ...SHIPPING, fillBase: "overlay", restBase: "overlay", hoverPct: 8, activePct: 24, selectedPct: 32, borderPct: 12 },
  },
  { name: "Shipping", hint: "current — light wash", knobs: SHIPPING },
  {
    name: "Stronger",
    hint: "same wash, more contrast",
    knobs: { ...SHIPPING, hoverPct: 6, activePct: 15, selectedPct: 20 },
  },
  {
    name: "Defined chip",
    hint: "light fill + hairline border",
    knobs: { ...SHIPPING, activePct: 10, selectedPct: 13, borderPct: 16 },
  },
  {
    name: "Recessed",
    hint: "darker, no border",
    knobs: { ...SHIPPING, fillBase: "overlay", restBase: "overlay", hoverPct: 10, activePct: 32, selectedPct: 42 },
  },
  {
    name: "Underline",
    hint: "quiet fill + accent bar",
    knobs: { ...SHIPPING, activePct: 6, selectedPct: 9, underline: true },
  },
];

const ACCENT_SWATCHES: { label: string; value: string }[] = [
  { label: "blue", value: "var(--color-border-highlight)" },
  { label: "fg", value: "var(--color-foreground)" },
  { label: "green", value: "var(--color-success)" },
  { label: "amber", value: "var(--color-warning-foreground)" },
];

function mix(base: string, pct: number): string {
  if (pct <= 0) return "transparent";
  return `color-mix(in oklab, ${base} ${pct}%, transparent)`;
}

const FILL_BASE_VAR: Record<Knobs["fillBase"], string> = {
  foreground: "var(--color-foreground)",
  accent: "var(--color-border-highlight)",
  overlay: "var(--color-overlay)",
};

function knobsToVars(k: Knobs): Record<string, string> {
  const selBase = FILL_BASE_VAR[k.fillBase];
  const restBase = FILL_BASE_VAR[k.restBase];
  // Rim is always a faint light line so it reads against a dark fill.
  const activeBorder = mix("var(--color-foreground)", k.borderPct);
  return {
    "--workspace-shell-tab-inactive-background": mix(restBase, k.inactivePct),
    "--workspace-shell-tab-inactive-border": "transparent",
    "--workspace-shell-tab-hover-background": mix(restBase, k.hoverPct),
    "--workspace-shell-tab-hover-border": "transparent",
    "--workspace-shell-tab-active-background": mix(selBase, k.activePct),
    "--workspace-shell-tab-active-border": activeBorder,
    "--workspace-shell-tab-selected-background": mix(selBase, k.selectedPct),
    "--workspace-shell-tab-selected-border": activeBorder,
    "--workspace-shell-tab-radius": `${k.radius}px`,
    "--workspace-shell-tab-font-weight": String(k.weight),
  };
}

function knobsEqual(a: Knobs, b: Knobs): boolean {
  return (Object.keys(a) as (keyof Knobs)[]).every((key) => a[key] === b[key]);
}

function Tab({ state, width, knobs }: { state: TabState; width: number; knobs: Knobs }) {
  const iconFixture: IconFixture = {
    agentKind: state.agentKind,
    viewState: state.viewState,
    delegatedAgent: null,
    isResolvingSession: state.isResolvingSession ?? false,
  };
  const badge = knobs.showBadge
    ? renderChatTabStatusBadge({
        viewState: state.viewState,
        hasUnreadActivity: state.hasUnreadActivity ?? false,
      })
    : undefined;
  const showUnderline = knobs.underline && (state.isActive ?? false);
  return (
    <div className="relative flex shrink-0">
      <ChromeWorkspaceTab
        isActive={state.isActive ?? false}
        isMultiSelected={state.isMultiSelected ?? false}
        width={width}
        icon={renderChatTabIcon(iconFixture)}
        label={state.label}
        badge={badge}
        onSelect={() => {}}
        onClose={() => {}}
      />
      {showUnderline && (
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-px left-2 right-2 h-0.5 rounded-full"
          style={{ backgroundColor: knobs.underlineColor }}
        />
      )}
    </div>
  );
}

function Strip({
  states,
  knobs,
  widthFor,
  captioned = false,
}: {
  states: TabState[];
  knobs: Knobs;
  widthFor: (s: TabState, i: number) => number;
  captioned?: boolean;
}) {
  return (
    <div
      className={`flex items-center rounded-lg border border-border/40 bg-background px-3 ${captioned ? "py-3" : "h-12"}`}
      style={knobsToVars(knobs) as CSSProperties}
    >
      <span className="shrink-0 truncate px-1 pr-3 text-sm font-medium text-muted-foreground">
        proliferate
      </span>
      <div className="flex min-w-0 flex-1 items-start overflow-hidden" style={{ gap: knobs.gap }}>
        {states.map((s, i) => (
          <div key={i} className="flex items-start" style={{ gap: knobs.gap }}>
            {knobs.separators && i > 0 && (
              <span aria-hidden className="mt-2 h-3 w-px shrink-0 bg-border/60" />
            )}
            <div className="flex flex-col items-start gap-1">
              <Tab state={s} width={widthFor(s, i)} knobs={knobs} />
              {captioned && (
                <span className="px-1 text-[10px] leading-tight text-muted-foreground">
                  {s.caption}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span className="shrink-0">{label}</span>
      {children}
    </label>
  );
}

function Slider({
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-40"
      />
      <span className="w-12 text-right tabular-nums text-foreground">
        {value}
        {suffix}
      </span>
    </span>
  );
}

function TintPicker({ value, onChange }: { value: Tint; onChange: (v: Tint) => void }) {
  return (
    <span className="flex gap-1">
      {(["foreground", "accent", "overlay"] as const).map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => onChange(b)}
          className={`rounded-md border px-2 py-1 text-xs ${
            value === b
              ? "border-transparent bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {b === "foreground" ? "light" : b === "accent" ? "accent" : "dark"}
        </button>
      ))}
    </span>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`h-5 w-9 shrink-0 rounded-full border transition-colors ${
        value ? "border-transparent bg-primary" : "border-border bg-transparent"
      }`}
    >
      <span
        className={`block size-4 rounded-full bg-background transition-transform ${
          value ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function TabStripPlaygroundPage() {
  const [k, setK] = useState<Knobs>(PRESETS[0].knobs);
  const [width, setWidth] = useState(140);
  const set = <K extends keyof Knobs>(key: K, value: Knobs[K]) =>
    setK((prev) => ({ ...prev, [key]: value }));

  const cssReadout = Object.entries(knobsToVars(k))
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");

  return (
    <div className="flex min-h-screen bg-sidebar text-foreground">
      {/* Controls */}
      <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/40 bg-background/40 p-5">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold">Session tab bench</h1>
          <button
            type="button"
            onClick={() => setK(SHIPPING)}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Reset
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Presets
          </span>
          <div className="flex flex-col gap-1">
            {PRESETS.map((p) => {
              const selected = knobsEqual(k, p.knobs);
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setK(p.knobs)}
                  className={`flex items-baseline justify-between rounded-md border px-2 py-1.5 text-left ${
                    selected
                      ? "border-transparent bg-accent text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <span className="text-xs font-medium">{p.name}</span>
                  <span className="text-[10px] opacity-70">{p.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-px bg-border/50" />

        <div className="flex flex-col gap-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Non-selected tabs
          </span>
          <Row label="Rest tint">
            <TintPicker value={k.restBase} onChange={(v) => set("restBase", v)} />
          </Row>
          <Row label="Inactive fill">
            <Slider value={k.inactivePct} min={0} max={12} suffix="%" onChange={(v) => set("inactivePct", v)} />
          </Row>
          <Row label="Hover fill">
            <Slider value={k.hoverPct} min={0} max={20} suffix="%" onChange={(v) => set("hoverPct", v)} />
          </Row>

          <div className="my-1 h-px bg-border/50" />
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Selected tab
          </span>
          <Row label="Selected tint">
            <TintPicker value={k.fillBase} onChange={(v) => set("fillBase", v)} />
          </Row>
          <Row label="Selected fill">
            <Slider value={k.activePct} min={0} max={48} suffix="%" onChange={(v) => set("activePct", v)} />
          </Row>
          <Row label="Multi-select">
            <Slider value={k.selectedPct} min={0} max={48} suffix="%" onChange={(v) => set("selectedPct", v)} />
          </Row>
          <Row label="Border">
            <Slider value={k.borderPct} min={0} max={30} suffix="%" onChange={(v) => set("borderPct", v)} />
          </Row>
          <Row label="Radius">
            <Slider value={k.radius} min={0} max={16} suffix="px" onChange={(v) => set("radius", v)} />
          </Row>
          <Row label="Gap">
            <Slider value={k.gap} min={0} max={12} suffix="px" onChange={(v) => set("gap", v)} />
          </Row>
          <Row label="Font weight">
            <Slider value={k.weight} min={400} max={600} step={50} onChange={(v) => set("weight", v)} />
          </Row>

          <div className="my-1 h-px bg-border/50" />

          <Row label="Active underline">
            <Toggle value={k.underline} onChange={(v) => set("underline", v)} />
          </Row>
          {k.underline && (
            <Row label="Underline color">
              <span className="flex gap-1">
                {ACCENT_SWATCHES.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => set("underlineColor", s.value)}
                    aria-label={s.label}
                    className={`size-5 rounded-full border ${
                      k.underlineColor === s.value ? "ring-2 ring-ring ring-offset-1 ring-offset-background" : "border-border"
                    }`}
                    style={{ backgroundColor: s.value }}
                  />
                ))}
              </span>
            </Row>
          )}
          <Row label="Separators">
            <Toggle value={k.separators} onChange={(v) => set("separators", v)} />
          </Row>
          <Row label="Status badge">
            <Toggle value={k.showBadge} onChange={(v) => set("showBadge", v)} />
          </Row>
        </div>

        <div className="mt-2 flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            CSS values
          </span>
          <pre className="overflow-x-auto rounded-md border border-border/50 bg-surface-under p-2 text-[11px] leading-relaxed text-foreground-secondary">
            {cssReadout}
          </pre>
        </div>
      </aside>

      {/* Preview */}
      <main className="flex flex-1 flex-col gap-10 overflow-y-auto p-10">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              All states
            </h2>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              width
              <Slider value={width} min={44} max={200} suffix="px" onChange={setWidth} />
            </label>
          </div>
          <Strip states={STATES} knobs={k} widthFor={() => width} captioned />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Responsive widths (active tab)
          </h2>
          <Strip
            states={WIDTHS.map(() => ({ ...STATES[1], label: "billing webhook" }))}
            knobs={k}
            widthFor={(_s, i) => WIDTHS[i]}
          />
        </section>

        <p className="max-w-prose text-xs text-muted-foreground">
          Drives the real <code className="font-mono">ChromeWorkspaceTab</code> through its CSS
          custom properties — what you see is what shipping these values looks like. Land on a look
          and I&apos;ll bake the <span className="text-foreground">CSS values</span> into the theme
          (and port underline/separators into the component if you keep them).
        </p>
      </main>
    </div>
  );
}
