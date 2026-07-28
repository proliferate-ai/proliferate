import { useState } from "react";
import {
  Brain,
  Blocks,
  ChevronDown,
  ComposerControlButton,
  Globe,
  Plus,
  Target,
  Zap,
} from "@proliferate/ui";

export const ModelSelector = () => (
  <div className="flex flex-col items-start gap-3">
    <ComposerControlButton
      emphasizeLabel
      icon={<Brain className="icon-control" />}
      label="Claude Opus 4.5"
      trailing={<ChevronDown className="icon-compact" />}
      aria-label="Model: Claude Opus 4.5"
    />
    <ComposerControlButton
      emphasizeLabel
      icon={<Brain className="icon-control" />}
      label="GPT-5.2 Codex"
      detail="via OpenAI"
      trailing={<ChevronDown className="icon-compact" />}
      aria-label="Model: GPT-5.2 Codex"
    />
  </div>
);

export const ActiveAndDetail = () => (
  <div className="flex flex-col items-start gap-3">
    <ComposerControlButton
      icon={<Zap className="icon-control" />}
      label="Build"
      detail="auto-approve edits"
    />
    <ComposerControlButton
      active
      icon={<Zap className="icon-control" />}
      label="Bypass"
      detail="no approvals"
    />
    <ComposerControlButton
      disabled
      icon={<Globe className="icon-control" />}
      label="Web search"
      detail="not supported by this agent"
    />
  </div>
);

export const IconOnly = () => (
  <div className="flex w-96 items-center gap-1 rounded-xl border border-border bg-composer-background px-2 py-2">
    <ComposerControlButton
      iconOnly
      icon={<Plus className="icon-control" />}
      label="Attach file"
      title="Attach a file to this message"
    />
    <ComposerControlButton
      iconOnly
      icon={<Target className="icon-control" />}
      label="Set goal"
      title="Give the agent an objective to keep pursuing."
    />
    <ComposerControlButton
      iconOnly
      active
      icon={<Blocks className="icon-control" />}
      label="Integrations"
      title="3 connectors enabled"
    />
  </div>
);

export const ControlRow = () => {
  const [mode, setMode] = useState(0);
  const modes = [
    { label: "Build", detail: "auto-approve edits" },
    { label: "Plan", detail: "read-only" },
  ];
  const current = modes[mode % modes.length];
  return (
    <div className="flex w-full max-w-2xl items-center gap-1 rounded-xl border border-border bg-composer-background px-2 py-2">
      <ComposerControlButton
        emphasizeLabel
        icon={<Brain className="icon-control" />}
        label="Claude Opus 4.5"
        trailing={<ChevronDown className="icon-compact" />}
      />
      <ComposerControlButton
        emphasizeLabel
        icon={<Zap className="icon-control" />}
        label={current.label}
        detail={current.detail}
        onClick={() => setMode((value) => value + 1)}
      />
      <ComposerControlButton
        iconOnly
        icon={<Blocks className="icon-control" />}
        label="Integrations"
      />
      <ComposerControlButton
        iconOnly
        icon={<Plus className="icon-control" />}
        label="Attach file"
      />
    </div>
  );
};
