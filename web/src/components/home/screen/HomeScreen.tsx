import { Bot, Cloud, GitBranch, GitPullRequest, Smartphone, Users } from "lucide-react";
import { useState } from "react";

import type { NewChatPickerId, PickerView } from "@proliferate/product-ui/new-chat/NewChatSurface";
import { NewChatSurface } from "@proliferate/product-ui/new-chat/NewChatSurface";

import { workspaces } from "../../../lib/fixtures/web-fixtures";

type ModeId = "dispatch" | "shared" | "personal";

const MODE_PLACEHOLDERS: Record<ModeId, string> = {
  dispatch: "Describe a quick remote task...",
  shared: "Ask the shared sandbox to take this on...",
  personal: "Ask Proliferate to work in your sandbox...",
};

export function HomeScreen() {
  const [draft, setDraft] = useState("");
  const [targetId, setTargetId] = useState(workspaces[0]?.id ?? "shared-cloud");
  const [modelId, setModelId] = useState("gpt-5.4");
  const [modeId, setModeId] = useState<ModeId>("dispatch");
  const [submitting, setSubmitting] = useState(false);

  function handlePickerSelect(picker: NewChatPickerId, itemId: string) {
    if (picker === "target") {
      setTargetId(itemId);
      return;
    }
    if (picker === "model") {
      setModelId(itemId);
      return;
    }
    setModeId(itemId as ModeId);
  }

  function handleSubmit() {
    if (!draft.trim()) return;
    setSubmitting(true);
    window.setTimeout(() => {
      setSubmitting(false);
      setDraft("");
    }, 500);
  }

  return (
    <div className="h-full" data-telemetry-block>
      <NewChatSurface
        heading="What should we run?"
        draft={draft}
        placeholder={MODE_PLACEHOLDERS[modeId]}
        canSubmit={Boolean(draft.trim()) && !submitting}
        submitting={submitting}
        target={buildTargetPicker(targetId)}
        model={buildModelPicker(modelId)}
        mode={buildModePicker(modeId)}
        notices={[
          {
            id: "mock-cloud",
            tone: "neutral",
            text: "Cloud API wiring is intentionally light in this PR; this surface is using shared UI and fixture targets.",
          },
        ]}
        actions={[
          {
            id: "branch",
            label: "Open from branch",
            icon: <GitBranch size={14} />,
          },
          {
            id: "pr",
            label: "Review pull request",
            icon: <GitPullRequest size={14} />,
          },
          {
            id: "agent",
            label: "Use saved agent",
            icon: <Bot size={14} />,
          },
        ]}
        onDraftChange={setDraft}
        onSubmit={handleSubmit}
        onPickerSelect={handlePickerSelect}
      />
    </div>
  );
}

function buildTargetPicker(selectedId: string): PickerView {
  return {
    label: "Target",
    icon: <Cloud size={13} />,
    groups: [
      {
        id: "targets",
        label: "Cloud targets",
        items: workspaces.map((workspace) => ({
          id: workspace.id,
          label: workspace.name,
          description: `${workspace.repoLabel} · ${workspace.branchLabel}`,
          selected: workspace.id === selectedId,
          icon: workspace.kind === "shared" ? <Users size={13} /> : <Cloud size={13} />,
        })),
      },
    ],
  };
}

function buildModelPicker(selectedId: string): PickerView {
  const models = [
    { id: "gpt-5.4", label: "GPT-5.4", description: "Balanced cloud work" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "Fast lighter tasks" },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "Coding-heavy work" },
  ];
  return {
    label: "Model",
    icon: <Bot size={13} />,
    groups: [
      {
        id: "models",
        items: models.map((model) => ({
          ...model,
          selected: model.id === selectedId,
        })),
      },
    ],
  };
}

function buildModePicker(selectedId: ModeId): PickerView {
  const modes = [
    {
      id: "dispatch",
      label: "Dispatch",
      description: "Lightweight remote task",
      icon: <Smartphone size={13} />,
    },
    {
      id: "shared",
      label: "Shared chat",
      description: "Team sandbox, claimable",
      icon: <Users size={13} />,
    },
    {
      id: "personal",
      label: "Personal cloud",
      description: "Your repos and tools",
      icon: <Cloud size={13} />,
    },
  ];
  return {
    label: "Mode",
    icon: <Smartphone size={13} />,
    groups: [
      {
        id: "modes",
        items: modes.map((mode) => ({
          ...mode,
          selected: mode.id === selectedId,
        })),
      },
    ],
  };
}
