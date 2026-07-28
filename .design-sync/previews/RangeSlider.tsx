import { useState, type ReactNode } from "react";
import { Label, RangeSlider } from "@proliferate/ui";

/**
 * Ported from the product's own slider row (PlaygroundThinkingTimingControls):
 * label on the left, mono value readout on the right, full-width track below.
 */
function SliderRow({
  id,
  label,
  readout,
  children,
}: {
  id: string;
  label: string;
  readout: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-96 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="mb-0">
          {label}
        </Label>
        <span className="font-mono text-ui-sm text-muted-foreground">{readout}</span>
      </div>
      {children}
    </div>
  );
}

export const ThinkingBudget = () => {
  const [value, setValue] = useState(64);
  return (
    <SliderRow id="thinking-budget" label="Thinking budget" readout={`${value}%`}>
      <RangeSlider
        id="thinking-budget"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) => setValue(Number(event.currentTarget.value))}
      />
    </SliderRow>
  );
};

export const Stepped = () => {
  const [value, setValue] = useState(3);
  return (
    <SliderRow
      id="parallel-agents"
      label="Parallel agents per workspace"
      readout={String(value)}
    >
      <RangeSlider
        id="parallel-agents"
        min={1}
        max={8}
        step={1}
        value={value}
        onChange={(event) => setValue(Number(event.currentTarget.value))}
      />
      <div className="flex justify-between text-ui-sm text-muted-foreground">
        <span>1</span>
        <span>8</span>
      </div>
    </SliderRow>
  );
};

export const Extremes = () => {
  const [low, setLow] = useState(0);
  const [high, setHigh] = useState(100);
  return (
    <div className="flex flex-col gap-6">
      <SliderRow id="idle-timeout" label="Idle timeout" readout="Off">
        <RangeSlider
          id="idle-timeout"
          min={0}
          max={100}
          value={low}
          onChange={(event) => setLow(Number(event.currentTarget.value))}
        />
      </SliderRow>
      <SliderRow id="log-retention" label="Log retention" readout="30 days">
        <RangeSlider
          id="log-retention"
          min={0}
          max={100}
          value={high}
          onChange={(event) => setHigh(Number(event.currentTarget.value))}
        />
      </SliderRow>
    </div>
  );
};

export const Disabled = () => (
  <SliderRow id="download-progress" label="Download progress" readout="0%">
    <RangeSlider id="download-progress" min={0} max={100} value={0} disabled readOnly />
  </SliderRow>
);
