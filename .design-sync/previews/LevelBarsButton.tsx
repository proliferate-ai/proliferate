import { useState, type ReactNode } from "react";
import { LevelBarsButton } from "@proliferate/ui";

const REASONING_LEVELS = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
];

const noop = () => {};

const Row = ({ caption, children }: { caption: string; children: ReactNode }) => (
  <div className="flex items-center gap-4">
    <span className="w-36 shrink-0 text-ui-sm text-muted-foreground">{caption}</span>
    <div className="flex items-center gap-2 rounded-full bg-composer-background px-2 py-1">
      {children}
    </div>
  </div>
);

const Panel = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface">
    <div className="border-b border-border px-4 py-2 text-ui text-foreground">{title}</div>
    <div className="flex flex-col gap-3 p-4">{children}</div>
  </div>
);

export const ReasoningLadder = () => {
  const [index, setIndex] = useState(1);
  return (
    <Panel title="Reasoning effort — composer control">
      <span className="text-ui-sm text-muted-foreground">
        One click steps to the next level and wraps back to the lowest.
      </span>
      <div className="flex w-fit items-center gap-2 rounded-full bg-composer-background px-2 py-1">
        <LevelBarsButton
          levels={REASONING_LEVELS}
          currentIndex={index}
          onStep={(next) => setIndex(REASONING_LEVELS.findIndex((l) => l.value === next))}
          levelOptionAttribute="data-reasoning-effort-option"
        />
      </div>
    </Panel>
  );
};

export const EveryLevel = () => (
  <Panel title="currentIndex — lit bars track the level">
    {REASONING_LEVELS.map((level, i) => (
      <Row key={level.value} caption={`currentIndex=${i}`}>
        <LevelBarsButton levels={REASONING_LEVELS} currentIndex={i} onStep={noop} />
      </Row>
    ))}
  </Panel>
);

export const Emphasis = () => (
  <Panel title="emphasis — tier treatment at the top level">
    <Row caption="emphasis=&quot;none&quot;">
      <LevelBarsButton levels={REASONING_LEVELS} currentIndex={2} onStep={noop} emphasis="none" />
    </Row>
    <Row caption="emphasis=&quot;max&quot;">
      <LevelBarsButton levels={REASONING_LEVELS} currentIndex={2} onStep={noop} emphasis="max" />
    </Row>
    <Row caption="emphasis=&quot;ultra&quot;">
      <LevelBarsButton levels={REASONING_LEVELS} currentIndex={2} onStep={noop} emphasis="ultra" />
    </Row>
  </Panel>
);

export const LadderLengths = () => {
  const ladders = [
    { caption: "2 levels", levels: [{ value: "off", label: "off" }, { value: "on", label: "on" }], index: 1 },
    { caption: "3 levels", levels: REASONING_LEVELS, index: 2 },
    {
      caption: "5 levels",
      levels: [
        { value: "minimal", label: "minimal" },
        { value: "low", label: "low" },
        { value: "medium", label: "medium" },
        { value: "high", label: "high" },
        { value: "ultra", label: "ultra" },
      ],
      index: 3,
    },
  ];
  return (
    <Panel title="Ladder length — bar geometry adapts">
      {ladders.map((ladder) => (
        <Row key={ladder.caption} caption={ladder.caption}>
          <LevelBarsButton levels={ladder.levels} currentIndex={ladder.index} onStep={noop} />
        </Row>
      ))}
    </Panel>
  );
};

export const IconOnly = () => (
  <Panel title="iconOnly — bars without the level label">
    <span className="text-ui-sm text-muted-foreground">
      How the control sits in a tight composer control row.
    </span>
    <div className="flex w-fit items-center gap-2 rounded-full bg-composer-background px-2 py-1">
      <LevelBarsButton levels={REASONING_LEVELS} currentIndex={0} onStep={noop} iconOnly />
      <LevelBarsButton levels={REASONING_LEVELS} currentIndex={1} onStep={noop} iconOnly />
      <LevelBarsButton levels={REASONING_LEVELS} currentIndex={2} onStep={noop} iconOnly />
      <LevelBarsButton levels={REASONING_LEVELS} currentIndex={2} onStep={noop} iconOnly emphasis="max" />
      <LevelBarsButton levels={REASONING_LEVELS} currentIndex={2} onStep={noop} iconOnly emphasis="ultra" />
    </div>
  </Panel>
);
