import { useState, type CSSProperties } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { Label } from "@proliferate/ui/primitives/Label";
import { RangeSlider } from "@proliferate/ui/primitives/RangeSlider";

type ThinkingTimingKey =
  | "forwardSpeedMs"
  | "forwardGapMs"
  | "postForwardGapMs"
  | "returnSpeedMs"
  | "returnGapMs";

type ThinkingTiming = Record<ThinkingTimingKey, number>;

// PORT PENDING: this lab still emits background-position keyframes for the
// retired background-clip sweep. The product ThinkingText is now a two-layer
// compositor sweep (.thinking-text-band / -glyphs) driven by
// --thinking-text-duration / --thinking-text-easing; the sliders here no
// longer affect it until the timeline builder is ported to translateX pairs
// (band = 1.5×bgpos − 17.5, glyphs = −0.5×band).
const PLAYGROUND_THINKING_ANIMATION_NAME = "playground-thinking-text-sweep";

const DEFAULT_THINKING_TIMING: ThinkingTiming = {
  forwardSpeedMs: 740,
  forwardGapMs: 0,
  postForwardGapMs: 800,
  returnSpeedMs: 690,
  returnGapMs: 0,
};

const TIMING_CONTROLS: Array<{
  key: ThinkingTimingKey;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  {
    key: "forwardSpeedMs",
    label: "Speed of -> passes",
    min: 280,
    max: 900,
    step: 10,
  },
  {
    key: "forwardGapMs",
    label: "Gap between -> and ->",
    min: 0,
    max: 360,
    step: 5,
  },
  {
    key: "postForwardGapMs",
    label: "Gap after second -> before <-",
    min: 0,
    max: 1_000,
    step: 10,
  },
  {
    key: "returnSpeedMs",
    label: "Speed of <- and final ->",
    min: 280,
    max: 1_000,
    step: 10,
  },
  {
    key: "returnGapMs",
    label: "Gap between <- and final ->",
    min: 0,
    max: 600,
    step: 10,
  },
];

type TimelineFrame = {
  ms: number;
  css: string;
};

export function PlaygroundThinkingTimingControls() {
  const [timing, setTiming] = useState<ThinkingTiming>(DEFAULT_THINKING_TIMING);
  const timeline = buildThinkingTimeline(timing);
  const animationStyle = {
    "--thinking-text-animation":
      `${PLAYGROUND_THINKING_ANIMATION_NAME} ${timeline.durationMs}ms cubic-bezier(0.45, 0, 0.55, 1) infinite`,
  } as CSSProperties & Record<"--thinking-text-animation", string>;

  return (
    <section
      className="space-y-3 rounded-md border border-border p-4"
      data-thinking-timing-controls
    >
      <style>{timeline.keyframesCss}</style>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">Thinking timing lab</h2>
          <p className="text-xs text-muted-foreground">
            Tune the playground-only sequence: {"->"} {"->"} gap {"<-"} gap {"->"}.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setTiming(DEFAULT_THINKING_TIMING)}
        >
          Reset
        </Button>
      </div>

      <div className="flex h-14 items-center rounded-md border border-border px-4">
        <ThinkingText style={animationStyle} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {TIMING_CONTROLS.map((control) => (
          <TimingRangeControl
            key={control.key}
            control={control}
            value={timing[control.key]}
            onChange={(value) => {
              setTiming((current) => ({
                ...current,
                [control.key]: value,
              }));
            }}
          />
        ))}
      </div>

      <p
        className="rounded-md bg-foreground/5 px-3 py-2 font-mono text-base leading-5 text-muted-foreground"
        data-thinking-timing-summary
      >
        forward {timing.forwardSpeedMs}ms {" | "}gap {"->"}/{"->"}{" "}
        {timing.forwardGapMs}ms {" | "}gap {"->"}/{"<-"} {timing.postForwardGapMs}ms
        {" | "}return {timing.returnSpeedMs}ms {" | "}gap {"<-"}/{"->"}{" "}
        {timing.returnGapMs}ms {" | "}cycle {timeline.durationMs}ms
      </p>
    </section>
  );
}

function TimingRangeControl({
  control,
  value,
  onChange,
}: {
  control: (typeof TIMING_CONTROLS)[number];
  value: number;
  onChange: (value: number) => void;
}) {
  const id = `thinking-${control.key}`;

  return (
    <div className="space-y-2 rounded-md bg-foreground/5 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="mb-0 text-foreground">
          {control.label}
        </Label>
        <span className="font-mono text-base text-muted-foreground">
          {value}ms
        </span>
      </div>
      <RangeSlider
        id={id}
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

function buildThinkingTimeline(timing: ThinkingTiming) {
  const frames: TimelineFrame[] = [];
  let elapsedMs = 0;

  const addFrame = (durationMs: number, css: string) => {
    elapsedMs += Math.max(0, durationMs);
    frames.push({ ms: elapsedMs, css });
  };

  frames.push({
    ms: 0,
    css: "opacity: 0; background-position: 145% 0;",
  });
  addFrame(120, "opacity: 0; background-position: 145% 0;");
  addFrame(80, "opacity: 0.95; background-position: 145% 0;");
  addFrame(timing.forwardSpeedMs, "opacity: 0.95; background-position: -55% 0;");
  addFrame(24, "opacity: 0; background-position: -62% 0;");
  addFrame(timing.forwardGapMs, "opacity: 0; background-position: -62% 0;");
  addFrame(1, "opacity: 0; background-position: 145% 0;");
  addFrame(55, "opacity: 0.95; background-position: 145% 0;");
  addFrame(timing.forwardSpeedMs, "opacity: 0.95; background-position: -55% 0;");
  addFrame(36, "opacity: 0; background-position: -62% 0;");
  addFrame(timing.postForwardGapMs, "opacity: 0; background-position: -62% 0;");
  addFrame(70, "opacity: 0.78; background-position: -55% 0;");
  addFrame(timing.returnSpeedMs, "opacity: 0.78; background-position: 42% 0;");
  addFrame(timing.returnGapMs, "opacity: 0.78; background-position: 42% 0;");
  addFrame(timing.returnSpeedMs, "opacity: 0.9; background-position: -42% 0;");
  addFrame(110, "opacity: 0; background-position: -62% 0;");
  addFrame(120, "opacity: 0; background-position: -62% 0;");

  return {
    durationMs: elapsedMs,
    keyframesCss: [
      `@keyframes ${PLAYGROUND_THINKING_ANIMATION_NAME} {`,
      ...frames.map((frame) => `  ${formatPercent(frame.ms, elapsedMs)}% { ${frame.css} }`),
      "}",
    ].join("\n"),
  };
}

function formatPercent(ms: number, totalMs: number) {
  return Number(((ms / totalMs) * 100).toFixed(3));
}
