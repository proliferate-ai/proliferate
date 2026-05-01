import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CHAT_MODEL_SELECTOR_LABELS } from "@/config/chat";
import type {
  ModelSelectorGroup as ModelSelectorGroupData,
  ModelSelectorProps,
  ModelSelectorSelection,
} from "@/lib/domain/chat/model-selection";
import { AgentSetupModal } from "@/components/agents/AgentSetupModal";
import { FixedPositionLayer } from "@/components/ui/layout/FixedPositionLayer";
import {
  Check,
  ChevronDown,
  Plus,
  ProviderIcon,
  Search,
} from "@/components/ui/icons";
import { useModelSelectorMenu } from "@/hooks/chat/use-model-selector-menu";
import { useNativeOverlayRegistration } from "@/hooks/ui/use-native-overlay-presence";
import { ComposerControlButton } from "./ComposerControlButton";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

export function ModelSelector({
  connectionState,
  currentModel,
  groups,
  hasAgents,
  isLoading,
  notReadyAgents,
  onSelect,
}: ModelSelectorProps) {
  const {
    open,
    addProviderOpen,
    setupAgent,
    search,
    triggerRef,
    menuPos,
    filteredGroups,
    setSearch,
    handleOpen,
    handleClose,
    toggleAddProvider,
    openSetupAgent,
    closeSetupAgent,
  } = useModelSelectorMenu({ groups });
  const selectorEnabled = connectionState === "healthy" && !isLoading && hasAgents;
  useNativeOverlayRegistration(selectorEnabled && open && menuPos !== null);

  useEffect(() => {
    if (!selectorEnabled && open) {
      handleClose();
    }
  }, [handleClose, open, selectorEnabled]);

  if (!selectorEnabled) {
    return (
      <ComposerControlButton
        disabled
        tone="quiet"
        label={
          connectionState === "connecting"
            ? "Connecting…"
            : isLoading
              ? "Loading agents…"
              : !hasAgents
                ? "No agents"
                : "No runtime"
        }
      />
    );
  }

  return (
    <div className="relative">
      <ComposerControlButton
        ref={triggerRef}
        active={open}
        icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="size-4 shrink-0" /> : undefined}
        label={currentModel?.displayName ?? CHAT_MODEL_SELECTOR_LABELS.empty}
        trailing={(
          <span className="flex items-center gap-1">
            <PendingConfigIndicator pendingState={currentModel?.pendingState ?? null} />
            <ChevronDown
              className={`size-3 text-[color:var(--color-composer-control-muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`}
            />
          </span>
        )}
        onClick={handleOpen}
        className="max-w-[15rem]"
      />

      {open && menuPos && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={handleClose} />
          <FixedPositionLayer
            className="fixed z-50"
            position={{ bottom: menuPos.bottom, left: menuPos.left }}
          >
            <div className="flex w-72 flex-col rounded-xl border border-border bg-popover shadow-floating">
              <div className="border-b border-border px-2 pb-2 pt-2">
                <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                  <Search className="size-3.5 shrink-0 text-muted-foreground/60" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={CHAT_MODEL_SELECTOR_LABELS.searchPlaceholder}
                    autoFocus
                    className="h-auto w-full border-none bg-transparent px-0 py-0 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                  />
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto p-1">
                {filteredGroups.map((group, index) => (
                  <ProviderModelGroup
                    key={group.kind}
                    group={group}
                    onSelect={(selection) => {
                      onSelect(selection);
                      handleClose();
                    }}
                    showSeparator={index > 0}
                  />
                ))}

                {filteredGroups.length === 0 && groups.length > 0 && (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                    {CHAT_MODEL_SELECTOR_LABELS.noMatchPrefix} "{search}"
                  </p>
                )}

                {groups.length === 0 && (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                    {CHAT_MODEL_SELECTOR_LABELS.noProviders}
                  </p>
                )}
              </div>

              <div className="border-t border-border p-1">
                <button
                  type="button"
                  onClick={toggleAddProvider}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3.5 shrink-0" />
                  <span>{CHAT_MODEL_SELECTOR_LABELS.addProvider}</span>
                </button>
              </div>
            </div>

            {addProviderOpen && notReadyAgents.length > 0 && (
              <div className="absolute bottom-0 left-[calc(18rem+8px)] w-56 rounded-xl border border-border bg-popover p-1 shadow-floating">
                {notReadyAgents.map((agent) => (
                  <button
                    key={agent.kind}
                    type="button"
                    onClick={() => openSetupAgent(agent)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-accent"
                  >
                    <ProviderIcon kind={agent.kind} className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-left">{agent.displayName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground/60">Setup</span>
                  </button>
                ))}
              </div>
            )}
          </FixedPositionLayer>
        </>,
        document.body,
      )}

      {setupAgent && (
        <AgentSetupModal
          agent={setupAgent}
          onClose={closeSetupAgent}
        />
      )}
    </div>
  );
}

function ProviderModelGroup({
  group,
  onSelect,
  showSeparator,
}: {
  group: ModelSelectorGroupData;
  onSelect: (selection: ModelSelectorSelection) => void;
  showSeparator: boolean;
}) {
  return (
    <>
      {showSeparator && <div className="mx-2 my-1 border-t border-border/60" />}
      <div className="px-2.5 pt-2 pb-1 text-sm text-muted-foreground/60">
        {group.providerDisplayName}
      </div>
      {group.models.map((model) => (
        <ModelRow
          key={model.modelId}
          kind={group.kind}
          actionKind={model.actionKind}
          displayName={model.displayName}
          isSelected={model.isSelected}
          onSelect={() => onSelect({ kind: group.kind, modelId: model.modelId })}
        />
      ))}
    </>
  );
}

function ModelRow({
  kind,
  actionKind,
  displayName,
  isSelected,
  onSelect,
}: {
  kind: string;
  actionKind: ModelSelectorGroupData["models"][number]["actionKind"];
  displayName: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const showNewChatBadge = actionKind === "open_new_chat" && !isSelected;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-accent"
    >
      <ProviderIcon kind={kind} className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate text-left">{displayName}</span>
      {showNewChatBadge && (
        <span className="shrink-0 text-xs text-muted-foreground/60">
          {CHAT_MODEL_SELECTOR_LABELS.newChatBadge}
        </span>
      )}
      {isSelected && <Check className="size-3.5 shrink-0 text-foreground/60" />}
    </button>
  );
}
