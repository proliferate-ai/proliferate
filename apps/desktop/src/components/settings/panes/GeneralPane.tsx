import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsMenu } from "@proliferate/ui/primitives/SettingsMenu";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { OpenTargetIcon } from "@/components/workspace/open-target/OpenTargetIcon";
import { APP_ROUTES } from "@/config/app-routes";
import { useAvailableEditors } from "@/hooks/access/tauri/shell/use-available-editors";
import { resolvePreferredOpenTarget } from "@/lib/domain/chat/composer/preference-resolvers";
import { emitTurnEnd } from "@/lib/infra/events/turn-end-events";
import type { DefaultNewWorkspaceMode, TurnEndSoundId } from "@/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

type SettingsOpenTargetIconId =
  | "cursor"
  | "vscode"
  | "windsurf"
  | "zed"
  | "sublime"
  | "finder"
  | "terminal";

interface SettingsEditorInfo {
  id: string;
  label: string;
  iconId?: SettingsOpenTargetIconId;
}

const EMPTY_EDITORS: SettingsEditorInfo[] = [];
const FINDER_TARGET = { id: "finder", label: "Finder", iconId: "finder" as const };
const TERMINAL_TARGET = { id: "terminal", label: "Terminal", iconId: "terminal" as const };
const BRANCH_PREFIX_OPTIONS = [
  { id: "none" as const, label: "None" },
  { id: "proliferate" as const, label: "Proliferate" },
  { id: "github_username" as const, label: "GitHub username" },
];
const NEW_WORKSPACE_MODE_OPTIONS: { id: DefaultNewWorkspaceMode; label: string }[] = [
  { id: "worktree", label: "Worktree" },
  { id: "local", label: "Local" },
];
const SOUND_LABELS: Record<TurnEndSoundId, string> = {
  ding: "Ding",
  gong: "Gong",
};
const TURN_END_SOUND_OPTIONS: { id: TurnEndSoundId; label: string }[] = [
  { id: "ding", label: "Ding" },
  { id: "gong", label: "Gong" },
];

export function GeneralPane() {
  const navigate = useNavigate();
  const { data: editors = EMPTY_EDITORS } = useAvailableEditors();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultOpenInTargetId: state.defaultOpenInTargetId,
    branchPrefixType: state.branchPrefixType,
    defaultNewWorkspaceMode: state.defaultNewWorkspaceMode,
    themePreset: state.themePreset,
    turnEndSoundEnabled: state.turnEndSoundEnabled,
    turnEndSoundId: state.turnEndSoundId,
    subagentsEnabled: state.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: state.coworkWorkspaceDelegationEnabled,
    pasteAttachmentsEnabled: state.pasteAttachmentsEnabled,
    set: state.set,
  })));

  const targets = useMemo(() => {
    const items: { id: string; label: string; iconId?: SettingsOpenTargetIconId }[] = editors.map((editor) => ({
      id: editor.id,
      label: editor.label,
      iconId: editor.iconId,
    }));
    items.push(FINDER_TARGET);
    items.push(TERMINAL_TARGET);
    return items;
  }, [editors]);

  const currentTarget = resolvePreferredOpenTarget(targets, {
    defaultOpenInTargetId: preferences.defaultOpenInTargetId,
  });
  const currentTargetLabel = currentTarget?.label ?? "Open";
  const currentBranchPrefixLabel = BRANCH_PREFIX_OPTIONS.find(
    (option) => option.id === preferences.branchPrefixType,
  )?.label ?? "None";
  const currentNewWorkspaceModeLabel = NEW_WORKSPACE_MODE_OPTIONS.find(
    (option) => option.id === preferences.defaultNewWorkspaceMode,
  )?.label ?? "Worktree";

  return (
    <section className="space-y-5">
      <SettingsPageHeader title="General" />

      <GeneralSection title="Preferences">
        <SettingsCard>
          <SettingsCardRow
            label="Default open in"
            description="Which app the Open in button uses"
          >
            <SettingsMenu
              label={currentTargetLabel}
              leading={<OpenTargetIcon iconId={currentTarget?.iconId} className="size-4 rounded-sm" />}
              className="w-44"
              menuClassName="w-52"
              groups={[{
                id: "targets",
                options: targets.map((target) => ({
                  id: target.id,
                  label: target.label,
                  icon: <OpenTargetIcon iconId={target.iconId} className="size-4 rounded-sm" />,
                  selected: currentTarget?.id === target.id,
                  onSelect: () => preferences.set("defaultOpenInTargetId", target.id),
                })),
              }]}
            />
          </SettingsCardRow>

          <SettingsCardRow
            label="Git branch prefix"
            description="Prefix for auto-generated branch names"
          >
            <SettingsMenu
              label={currentBranchPrefixLabel}
              className="w-44"
              menuClassName="w-48"
              groups={[{
                id: "branch-prefix",
                options: BRANCH_PREFIX_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  selected: preferences.branchPrefixType === option.id,
                  onSelect: () => preferences.set("branchPrefixType", option.id),
                })),
              }]}
            />
          </SettingsCardRow>

          <SettingsCardRow
            label="New workspace (⌘N)"
            description="What ⌘N creates by default"
          >
            <SettingsMenu
              label={currentNewWorkspaceModeLabel}
              className="w-44"
              menuClassName="w-44"
              groups={[{
                id: "new-workspace-mode",
                options: NEW_WORKSPACE_MODE_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  selected: preferences.defaultNewWorkspaceMode === option.id,
                  onSelect: () => preferences.set("defaultNewWorkspaceMode", option.id),
                })),
              }]}
            />
          </SettingsCardRow>

          <SettingsCardRow
            label="Turn long pastes into attachments"
            description="Large text pastes in chat become text-resource attachments instead of inline draft text."
          >
            <Switch
              checked={preferences.pasteAttachmentsEnabled}
              onChange={(value) => preferences.set("pasteAttachmentsEnabled", value)}
            />
          </SettingsCardRow>
        </SettingsCard>
      </GeneralSection>

      <GeneralSection title="Feedback">
        <SettingsCard>
          <SettingsCardRow
            label="Turn end sound"
            description="Play a sound when an agent finishes its turn"
          >
            <div className="flex items-center gap-2">
              {preferences.turnEndSoundEnabled && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="px-2.5 text-xs"
                    onClick={() => emitTurnEnd()}
                  >
                    Test
                  </Button>
                  <SettingsMenu
                    label={SOUND_LABELS[preferences.turnEndSoundId]}
                    className="w-32"
                    menuClassName="w-48"
                    groups={[{
                      id: "turn-end-sounds",
                      options: TURN_END_SOUND_OPTIONS
                        .filter((option) => option.id !== "gong" || preferences.themePreset === "tbpn")
                        .map((option) => ({
                          id: option.id,
                          label: option.label,
                          selected: option.id === preferences.turnEndSoundId,
                          onSelect: () => preferences.set("turnEndSoundId", option.id),
                        })),
                    }]}
                  />
                </>
              )}
              <Switch
                checked={preferences.turnEndSoundEnabled}
                onChange={(value) => preferences.set("turnEndSoundEnabled", value)}
              />
            </div>
          </SettingsCardRow>
        </SettingsCard>
      </GeneralSection>

      <GeneralSection title="Session policy">
        <SettingsCard>
          <SettingsCardRow
            label="Integrations setup"
            description="Configure cloud connectors and plugin packages."
          >
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(APP_ROUTES.integrations)}
            >
              Open Integrations
            </Button>
          </SettingsCardRow>
          <SettingsCardRow
            label="Allow coding agents to spin up subagents"
            description="Applies to new sessions. Existing sessions keep their saved delegation policy."
          >
            <Switch
              checked={preferences.subagentsEnabled}
              onChange={(value) => preferences.set("subagentsEnabled", value)}
            />
          </SettingsCardRow>
          <SettingsCardRow
            label="Allow cowork agents to create coding workspaces"
            description="Applies to new cowork sessions. Existing cowork sessions keep their saved workspace policy."
          >
            <Switch
              checked={preferences.coworkWorkspaceDelegationEnabled}
              onChange={(value) => preferences.set("coworkWorkspaceDelegationEnabled", value)}
            />
          </SettingsCardRow>
        </SettingsCard>
      </GeneralSection>
    </section>
  );
}

function GeneralSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
