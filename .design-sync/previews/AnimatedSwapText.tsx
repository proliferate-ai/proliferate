import { useState } from "react";
import {
  AnimatedSwapText,
  Brain,
  Button,
  ComposerControlButton,
  Zap,
} from "@proliferate/ui";

const MODES = [
  { key: "build", label: "Build", detail: "auto-approve edits" },
  { key: "plan", label: "Plan", detail: "read-only" },
  { key: "bypass", label: "Bypass", detail: "no approvals" },
];

export const ModeValue = () => (
  <div className="flex w-96 items-center gap-1 rounded-xl border border-border bg-composer-background px-2 py-2">
    <ComposerControlButton
      emphasizeLabel
      icon={<Brain className="icon-control" />}
      label={<AnimatedSwapText valueKey="opus-4-5" value="Claude Opus 4.5" />}
      aria-label="Model: Claude Opus 4.5"
    />
    <ComposerControlButton
      emphasizeLabel
      icon={<Zap className="icon-control" />}
      label={<AnimatedSwapText valueKey="build" value="Build" />}
      detail={<AnimatedSwapText valueKey="build-detail" value="auto-approve edits" />}
      aria-label="Session mode: Build"
    />
  </div>
);

export const CyclingValue = () => {
  const [index, setIndex] = useState(0);
  const mode = MODES[index % MODES.length];
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex w-96 items-center gap-1 rounded-xl border border-border bg-composer-background px-2 py-2">
        <ComposerControlButton
          emphasizeLabel
          icon={<Zap className="icon-control" />}
          label={<AnimatedSwapText valueKey={mode.key} value={mode.label} />}
          detail={<AnimatedSwapText valueKey={`${mode.key}-detail`} value={mode.detail} />}
          onClick={() => setIndex((value) => value + 1)}
        />
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIndex((value) => value + 1)}
      >
        Cycle mode (⇧Tab)
      </Button>
    </div>
  );
};

export const InlineMeta = () => (
  <div className="flex items-center gap-2 text-chat-meta text-muted-foreground">
    <Brain className="icon-compact" />
    <span>Model</span>
    <span className="text-foreground">
      <AnimatedSwapText valueKey="opus-4-5" value="Claude Opus 4.5" />
    </span>
    <span aria-hidden="true">·</span>
    <span>
      <AnimatedSwapText valueKey="effort-high" value="high effort" />
    </span>
  </div>
);
