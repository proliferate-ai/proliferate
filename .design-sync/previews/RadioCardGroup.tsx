import { useState } from "react";
import {
  ClaudeSparkle,
  CloudIcon,
  Monitor,
  RadioCardGroup,
  Robot,
  Server,
  SquareTerminal,
} from "@proliferate/ui";

export const HarnessChoice = () => {
  const [harness, setHarness] = useState("claude-code");
  return (
    <div className="max-w-3xl">
      <RadioCardGroup
        value={harness}
        onChange={setHarness}
        options={[
          {
            value: "claude-code",
            label: "Claude Code",
            description: "Anthropic's coding agent, run through AnyHarness.",
            icon: <ClaudeSparkle />,
          },
          {
            value: "codex",
            label: "Codex",
            description: "OpenAI's agent CLI with the sandboxed exec profile.",
            icon: <Robot />,
          },
          {
            value: "opencode",
            label: "OpenCode",
            description: "Bring-your-own-model harness over the OpenCode server.",
            icon: <SquareTerminal />,
          },
        ]}
      />
    </div>
  );
};

export const Vertical = () => {
  const [size, setSize] = useState("standard");
  return (
    <div className="max-w-lg">
      <RadioCardGroup
        orientation="vertical"
        value={size}
        onChange={setSize}
        options={[
          {
            value: "compact",
            label: "Compact — 2 vCPU · 4 GB",
            description: "Fine for single-repo sessions and doc edits.",
            icon: <Server />,
          },
          {
            value: "standard",
            label: "Standard — 4 vCPU · 8 GB",
            description: "Default sandbox size for cloud workspaces.",
            icon: <Server />,
          },
          {
            value: "large",
            label: "Large — 8 vCPU · 16 GB",
            description: "Monorepo builds and parallel test suites.",
            icon: <Server />,
          },
        ]}
      />
    </div>
  );
};

export const LabelsOnly = () => {
  const [surface, setSurface] = useState("cloud");
  return (
    <div className="max-w-lg">
      <RadioCardGroup
        value={surface}
        onChange={setSurface}
        options={[
          { value: "cloud", label: "Cloud sandbox", icon: <CloudIcon /> },
          { value: "local", label: "Local machine", icon: <Monitor /> },
        ]}
      />
    </div>
  );
};

export const WithDisabled = () => {
  const [target, setTarget] = useState("worktree");
  return (
    <div className="max-w-lg">
      <RadioCardGroup
        orientation="vertical"
        value={target}
        onChange={setTarget}
        options={[
          {
            value: "worktree",
            label: "New git worktree",
            description: "~/.proliferate-local/worktrees/proliferate",
          },
          {
            value: "checkout",
            label: "Reuse the current checkout",
            description: "Agents share the working tree on disk.",
          },
          {
            value: "clone",
            label: "Fresh clone",
            description: "Unavailable while the repo is still indexing.",
            disabled: true,
          },
        ]}
      />
    </div>
  );
};
