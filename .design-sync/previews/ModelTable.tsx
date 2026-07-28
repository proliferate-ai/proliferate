import { useState } from "react";
import { ModelTable } from "@proliferate/ui";

const CATALOG = [
  {
    id: "claude-opus-4-6-20260514",
    displayName: "Claude Opus 4.6",
    description: "Long agentic sessions.",
    provider: "anthropic",
    effort: { values: ["low", "medium", "high"], default: "high" },
    modes: ["read", "edit", "build"],
    fastMode: false,
    enabled: true,
  },
  {
    id: "claude-sonnet-4-6-20260514",
    displayName: "Claude Sonnet 4.6",
    description: "Everyday default.",
    provider: "anthropic",
    effort: { values: ["low", "medium", "high"], default: "medium" },
    modes: ["read", "edit", "build"],
    fastMode: true,
    enabled: true,
  },
  {
    id: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    description: "Quick edits, cheap.",
    provider: "anthropic",
    effort: { values: ["low", "medium"], default: "low" },
    modes: ["read", "edit"],
    fastMode: true,
    enabled: false,
  },
  {
    id: "gpt-5-codex",
    displayName: "GPT-5 Codex",
    provider: "openai",
    effort: { values: ["low", "medium", "high"], default: "medium" },
    modes: ["read", "edit", "build"],
    fastMode: false,
    enabled: true,
  },
];

const SPARSE = [
  {
    id: "claude-sonnet-4-6-20260514",
    displayName: "Claude Sonnet 4.6",
    provider: "anthropic",
    effort: { values: ["low", "medium", "high"], default: "medium" },
    modes: ["read", "edit", "build"],
    fastMode: true,
    enabled: true,
  },
  {
    id: "vertex/claude-opus-4-6",
    displayName: "vertex/claude-opus-4-6",
    enabled: false,
  },
  {
    id: "bedrock-nova-pro-v1",
    displayName: "Nova Pro",
    provider: "bedrock",
    modes: ["read"],
    enabled: true,
  },
];

export const Catalog = () => {
  const [rows, setRows] = useState(CATALOG);
  return (
    <ModelTable
      models={rows}
      onToggle={(id, enabled) =>
        setRows((current) => current.map((row) => (row.id === id ? { ...row, enabled } : row)))
      }
    />
  );
};

export const SparseRows = () => {
  const [rows, setRows] = useState(SPARSE);
  return (
    <ModelTable
      models={rows}
      onToggle={(id, enabled) =>
        setRows((current) => current.map((row) => (row.id === id ? { ...row, enabled } : row)))
      }
    />
  );
};

export const ModeOverflow = () => (
  <ModelTable
    models={[
      {
        id: "claude-sonnet-4-6-20260514",
        displayName: "Claude Sonnet 4.6",
        provider: "anthropic",
        effort: { values: ["low", "medium", "high"], default: "medium" },
        modes: ["read", "edit", "build", "plan", "review"],
        fastMode: true,
        enabled: true,
      },
      {
        id: "gpt-5-codex",
        displayName: "GPT-5 Codex",
        provider: "openai",
        effort: { values: ["low", "medium", "high"], default: "medium" },
        modes: ["read", "edit", "build", "plan"],
        fastMode: false,
        enabled: true,
      },
    ]}
    onToggle={() => {}}
  />
);

export const ReadOnlyToggles = () => (
  <ModelTable
    models={[
      {
        id: "gateway/claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        description: "Resolved by gateway.",
        provider: "gateway",
        effort: { values: ["low", "medium", "high"], default: "medium" },
        modes: ["read", "edit", "build"],
        fastMode: true,
        enabled: true,
        toggleDisabled: true,
      },
      {
        id: "gateway/gpt-5-codex",
        displayName: "GPT-5 Codex",
        description: "Blocked by org policy.",
        provider: "gateway",
        effort: { values: ["low", "medium", "high"], default: "medium" },
        modes: ["read", "edit", "build"],
        fastMode: false,
        enabled: false,
        toggleDisabled: true,
      },
    ]}
    onToggle={() => {}}
  />
);
