import { useState, type CSSProperties } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { Label } from "@proliferate/ui/primitives/Label";
import { RangeSlider } from "@proliferate/ui/primitives/RangeSlider";

// Timing lab for the PRODUCT ThinkingText animation. The two-layer compositor
// sweep (.thinking-text-band / .thinking-text-band-glyphs, design dom.css —
// shared with the cloud/web chat surfaces) has exactly two knobs — the CSS
// custom properties consumed by both keyframe pairs:
//
//   --thinking-text-duration  (product default 2.2s)
//   --thinking-text-easing    (product default linear)
//
// The controls below write those vars onto the preview labels, so what
// animates here is byte-for-byte the shipping mechanism; copy the summary
// line into dom.css to change the product defaults. The steps() preset
// exists to compare codex's cadenced feel (steps(48, end)) against the
// smooth sweep we ship.

type EasingKind = "linear" | "steps" | "ease-in-out";

interface ThinkingTiming {
  durationMs: number;
  easingKind: EasingKind;
  stepCount: number;
}

/** Mirrors the shipped fallbacks in desktop.css (2.2s linear); the step count
    only participates when the steps preset is active. */
const PRODUCT_DEFAULT_TIMING: ThinkingTiming = {
  durationMs: 2_200,
  easingKind: "linear",
  stepCount: 48,
};

const EASING_PRESETS: Array<{ kind: EasingKind; label: string }> = [
  { kind: "linear", label: "Linear (product)" },
  { kind: "steps", label: "Steps (codex cadence)" },
  { kind: "ease-in-out", label: "Ease-in-out" },
];

function resolveEasing(timing: ThinkingTiming): string {
  if (timing.easingKind === "steps") {
    return `steps(${timing.stepCount}, end)`;
  }
  return timing.easingKind;
}

export function PlaygroundThinkingTimingControls() {
  const [timing, setTiming] = useState<ThinkingTiming>(PRODUCT_DEFAULT_TIMING);
  const easing = resolveEasing(timing);
  const previewStyle = {
    "--thinking-text-duration": `${timing.durationMs}ms`,
    "--thinking-text-easing": easing,
  } as CSSProperties;

  return (
    <section
      className="space-y-3 rounded-md border border-border p-4"
      data-thinking-timing-controls
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">Thinking timing lab</h2>
          <p className="text-ui-sm text-muted-foreground">
            Drives the real product knobs (--thinking-text-duration /
            --thinking-text-easing) on the shipped band sweep.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setTiming(PRODUCT_DEFAULT_TIMING)}
        >
          Reset
        </Button>
      </div>

      <div className="flex flex-col justify-center gap-3 rounded-md border border-border px-4 py-3">
        <ThinkingText style={previewStyle} />
        <ThinkingText style={previewStyle} text="Searching the codebase for dock slot owners" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {EASING_PRESETS.map((preset) => (
          <Button
            key={preset.kind}
            type="button"
            variant={timing.easingKind === preset.kind ? "inverted" : "secondary"}
            size="sm"
            onClick={() => {
              setTiming((current) => ({ ...current, easingKind: preset.kind }));
            }}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <TimingRangeControl
          id="thinking-duration"
          label="Sweep duration"
          min={800}
          max={6_000}
          step={50}
          value={timing.durationMs}
          formatValue={(value) => `${value}ms`}
          onChange={(value) => {
            setTiming((current) => ({ ...current, durationMs: value }));
          }}
        />
        <TimingRangeControl
          id="thinking-step-count"
          label="Step count (steps preset)"
          min={8}
          max={96}
          step={4}
          value={timing.stepCount}
          disabled={timing.easingKind !== "steps"}
          formatValue={(value) => `${value} steps`}
          onChange={(value) => {
            setTiming((current) => ({ ...current, stepCount: value }));
          }}
        />
      </div>

      <p
        className="rounded-md bg-foreground/5 px-3 py-2 font-mono text-base leading-5 text-muted-foreground"
        data-thinking-timing-summary
      >
        --thinking-text-duration: {timing.durationMs}ms;{" "}
        --thinking-text-easing: {easing};
      </p>
    </section>
  );
}

function TimingRangeControl({
  id,
  label,
  min,
  max,
  step,
  value,
  disabled = false,
  formatValue,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div
      className={`space-y-2 rounded-md bg-foreground/5 p-3 ${disabled ? "opacity-50" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="mb-0 text-foreground">
          {label}
        </Label>
        <span className="font-mono text-base text-muted-foreground">
          {formatValue(value)}
        </span>
      </div>
      <RangeSlider
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}
