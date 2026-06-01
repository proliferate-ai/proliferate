import type {
  Dispatch,
  ReactNode,
  SetStateAction,
} from "react";
import {
  resolveComposerControlOptionDescription,
  resolveComposerControlOptionLabel,
} from "@/lib/domain/chat/session-controls/composer-config-submenu-presentation";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import type {
  ModelSelectorGroup,
  ModelSelectorProps,
  ModelSelectorSelection,
} from "@/lib/domain/chat/models/model-selector-types";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  Check,
  ChevronDown,
} from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { CHAT_MODEL_SELECTOR_LABELS } from "@/copy/chat/chat-copy";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

export function ComposerControlSubmenu({
  agentKind,
  control,
  onClose,
}: {
  agentKind: string | null;
  control: LiveSessionControlDescriptor;
  onClose: () => void;
}) {
  return (
    <ComposerPopoverSurface className="w-56 max-w-[calc(100vw-1rem)] p-1">
      <ComposerConfigControlRows
        agentKind={agentKind}
        control={control}
        onClose={onClose}
      />
    </ComposerPopoverSurface>
  );
}

export function ComposerHarnessSubmenu({
  activeKind,
  groups,
  onSelect,
}: {
  activeKind: string | null;
  groups: ModelSelectorGroup[];
  onSelect: (selection: ModelSelectorSelection) => void;
}) {
  return (
    <ComposerPopoverSurface className="w-56 max-w-[calc(100vw-1rem)] p-1">
      {groups.map((group) => (
        <PopoverMenuItem
          key={group.kind}
          icon={<ProviderIcon kind={group.kind} className="size-3.5 shrink-0" />}
          label={group.providerDisplayName}
          trailing={
            group.kind === activeKind
              ? <Check className="size-3.5 shrink-0" />
              : null
          }
          disabled={group.models.length === 0}
          onClick={() => {
            const selection = resolveHarnessSelection(group);
            if (selection) {
              onSelect(selection);
            }
          }}
        />
      ))}
    </ComposerPopoverSurface>
  );
}

export function ComposerAddProviderRows({
  addProviderOpen,
  notReadyAgents,
  onAddProviderOpenChange,
  onSetupAgent,
}: {
  addProviderOpen: boolean;
  notReadyAgents: ModelSelectorProps["notReadyAgents"];
  onAddProviderOpenChange: Dispatch<SetStateAction<boolean>>;
  onSetupAgent: (agent: ModelSelectorProps["notReadyAgents"][number]) => void;
}) {
  return (
    <>
      <PopoverMenuItem
        label={CHAT_MODEL_SELECTOR_LABELS.addProvider}
        trailing={<ChevronDown className={`size-3.5 shrink-0 transition-transform ${addProviderOpen ? "rotate-180" : ""}`} />}
        onClick={() => onAddProviderOpenChange((open) => !open)}
      />
      {addProviderOpen && notReadyAgents.map((agent) => (
        <PopoverMenuItem
          key={agent.kind}
          label={agent.displayName}
          trailing={<span className="text-xs text-muted-foreground">Setup</span>}
          className="ml-2 w-[calc(100%-0.5rem)]"
          onClick={() => onSetupAgent(agent)}
        />
      ))}
    </>
  );
}

export function ComposerSubmenuMenuItem({
  active,
  icon,
  label,
  onOpen,
}: {
  active: boolean;
  icon?: ReactNode;
  label: string;
  onOpen: (anchorElement: HTMLElement) => void;
}) {
  return (
    <PopoverMenuItem
      aria-expanded={active}
      aria-haspopup="menu"
      className={active ? "bg-popover-accent text-popover-foreground" : ""}
      data-state={active ? "open" : "closed"}
      icon={icon}
      label={label}
      trailing={<ChevronDown className="-rotate-90 size-3.5 shrink-0" />}
      onClick={(event) => onOpen(event.currentTarget)}
      onFocus={(event) => onOpen(event.currentTarget)}
      onMouseEnter={(event) => onOpen(event.currentTarget)}
    />
  );
}

function ComposerConfigControlRows({
  agentKind,
  control,
  onClose,
}: {
  agentKind: string | null;
  control: LiveSessionControlDescriptor;
  onClose: () => void;
}) {
  return (
    <>
      {control.options.map((option) => {
        return (
          <PopoverMenuItem
            key={option.value}
            label={resolveComposerControlOptionLabel(agentKind, control, option.value, option.label)}
            trailing={
              <span className="flex items-center gap-1">
                {option.selected && <Check className="size-3.5 shrink-0" />}
                {option.selected && <PendingConfigIndicator pendingState={control.pendingState} />}
              </span>
            }
            disabled={!control.settable}
            onClick={() => {
              control.onSelect(option.value);
              onClose();
            }}
          >
            {resolveComposerControlOptionDescription(agentKind, control, option.value, option.description)}
          </PopoverMenuItem>
        );
      })}
    </>
  );
}

function resolveHarnessSelection(
  group: ModelSelectorGroup,
): ModelSelectorSelection | null {
  const selectedModel = group.models.find((model) => model.isSelected) ?? group.models[0] ?? null;
  return selectedModel
    ? {
      kind: group.kind,
      modelId: selectedModel.modelId,
    }
    : null;
}
