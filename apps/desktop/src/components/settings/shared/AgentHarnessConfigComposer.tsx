import { Button } from "@proliferate/ui/primitives/Button";
import { ChatComposerSurface } from "@proliferate/product-ui/chat/composer/ChatComposerSurface";
import { ComposerTextarea } from "@proliferate/product-ui/chat/composer/ComposerTextarea";
import { ComposerTextareaFrame } from "@proliferate/product-ui/chat/composer/ComposerTextareaFrame";
import {
  AgentHarnessModelSelector,
  type AgentHarnessModelGroup,
  type AgentHarnessModelOption,
} from "@/components/agents/AgentHarnessModelSelector";
import { SessionConfigControls } from "@/components/workspace/chat/input/SessionConfigControls";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";

export type AgentHarnessConfigModelOption = AgentHarnessModelOption;
export type AgentHarnessConfigModelGroup = AgentHarnessModelGroup;

interface AgentHarnessConfigComposerProps {
  agentKind: string | null;
  agentDisplayName: string | null;
  selectedModelId: string | null;
  selectedModelLabel: string | null;
  modelGroups: AgentHarnessConfigModelGroup[];
  controls: LiveSessionControlDescriptor[];
  disabled?: boolean;
  saving?: boolean;
  actionLabel?: string;
  placeholder?: string;
  onSelectModel: (agentKind: string, modelId: string) => void;
  onAction?: () => void;
}

export function AgentHarnessConfigComposer({
  agentKind,
  agentDisplayName,
  selectedModelId,
  selectedModelLabel,
  modelGroups,
  controls,
  disabled = false,
  saving = false,
  actionLabel,
  placeholder = "Describe a task",
  onSelectModel,
  onAction,
}: AgentHarnessConfigComposerProps) {
  const modelLabel = selectedModelLabel ?? "Model";
  const effectiveModelGroups = modelGroups.length > 0
    ? modelGroups
    : agentKind
      ? [{ agentKind, agentDisplayName: agentDisplayName ?? "Agent", models: [] }]
      : [];
  const canSelectModel = !disabled && effectiveModelGroups.some((group) => group.models.length > 0);
  const canUseControls = !disabled && agentKind !== null;

  return (
    <ChatComposerSurface overflowMode="clip" className="[--radius-composer:0.875rem]">
      <ComposerTextareaFrame topInset="standard">
        <ComposerTextarea
          data-telemetry-mask
          readOnly
          tabIndex={-1}
          rows={1}
          value=""
          placeholder={placeholder}
          className="pointer-events-none h-[1.125rem] min-h-[1.125rem] overflow-hidden"
        />
      </ComposerTextareaFrame>
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[5px] px-2">
        <div className={`flex min-w-0 flex-wrap items-center gap-[5px] ${
          canUseControls ? "" : "pointer-events-none opacity-55"
        }`}
        >
          <AgentHarnessModelSelector
            label={modelLabel}
            agentKind={agentKind}
            selectedModelId={selectedModelId}
            disabled={!canSelectModel}
            modelGroups={effectiveModelGroups}
            onSelectModel={onSelectModel}
          />
          <SessionConfigControls agentKind={agentKind} controls={controls} />
        </div>
        {actionLabel && onAction ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={saving}
            disabled={disabled || saving || !agentKind || !selectedModelId}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </ChatComposerSurface>
  );
}
