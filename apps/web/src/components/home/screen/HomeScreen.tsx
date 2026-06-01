import { Bot, Cloud, GitBranch, Plus } from "lucide-react";

import type {
  PickerView,
} from "@proliferate/product-ui/new-chat/NewChatSurface";
import { NewChatSurface } from "@proliferate/product-ui/new-chat/NewChatSurface";
import { AddCloudEnvironmentDialogController } from "@proliferate/product-surfaces/settings/cloud-environments/AddCloudEnvironmentDialogController";

import { useWebHomeScreen } from "../../../hooks/home/facade/use-web-home-screen";
import type { RepoOption } from "../../../lib/domain/home/cloud-home-launch-model";

const HOME_PLACEHOLDER = "Describe a quick remote task...";

export function HomeScreen() {
  const home = useWebHomeScreen();

  return (
    <div className="h-full" data-telemetry-block>
      <NewChatSurface
        heading="What should we run?"
        draft={home.draft}
        placeholder={HOME_PLACEHOLDER}
        canSubmit={home.canSubmit}
        submitting={home.submitting}
        target={buildTargetPicker(home.repoId, home.repoOptions, home.repoLoading)}
        model={buildModelPicker(home.resolvedModelId)}
        mode={buildModePicker()}
        extraComposerControls={home.composerControls}
        notices={home.notices}
        transcriptRows={home.transcriptRows}
        recentItems={home.recentItems}
        recentLoading={home.recentLoading}
        commandMessage={home.commandMessage}
        actions={[
          {
            id: "add-repo",
            label: "Add cloud environment",
            icon: <Plus size={13} />,
          },
        ]}
        onDraftChange={home.setDraft}
        onSubmit={() => void home.handleSubmit()}
        onPickerSelect={home.handlePickerSelect}
        onAction={home.handleAction}
        onRecentSelect={home.handleRecentSelect}
      />
      <AddCloudEnvironmentDialogController
        open={home.addRepoOpen}
        onClose={() => home.setAddRepoOpen(false)}
        onEnvironmentAdded={home.handleRepoSelected}
      />
    </div>
  );
}

function buildTargetPicker(
  selectedId: string,
  repoOptions: RepoOption[],
  loading: boolean,
): PickerView {
  return {
    label: loading ? "Loading repos" : "Repository",
    icon: <GitBranch size={13} />,
    disabled: loading || repoOptions.length === 0,
    groups: [
      {
        id: "repositories",
        label: "GitHub repositories",
        items: repoOptions.map((repo) => ({
          id: repo.id,
          label: repo.label,
          description: repo.description,
          icon: <GitBranch size={13} />,
          selected: repo.id === selectedId,
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

function buildModePicker(): PickerView {
  return {
    label: "Mode",
    icon: <Cloud size={13} />,
    disabled: true,
    groups: [
      {
        id: "modes",
        items: [
          {
            id: "cloud-task",
            label: "Cloud task",
            description: "Create a workspace and send this prompt",
            icon: <Cloud size={13} />,
            selected: true,
          },
        ],
      },
    ],
  };
}
