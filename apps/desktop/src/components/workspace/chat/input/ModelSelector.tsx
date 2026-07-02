import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CHAT_MODEL_SELECTOR_LABELS } from "@/copy/chat/chat-copy";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import type {
  ModelSelectorGroup as ModelSelectorGroupData,
  ModelSelectorProps,
  ModelSelectorSelection,
} from "@/lib/domain/chat/models/model-selector-types";
import { FixedPositionLayer } from "@proliferate/ui/layout/FixedPositionLayer";
import { Input } from "@proliferate/ui/primitives/Input";
import { POPOVER_FRAME_CLASS } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  Check,
  ChevronDown,
  Plus,
  Search,
} from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { useModelSelectorMenu } from "@/hooks/chat/ui/use-model-selector-menu";
import { useNativeOverlayRegistration } from "@proliferate/ui/overlays/overlay-presence";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

export function ModelSelector({
  connectionState,
  currentModel,
  groups,
  hasAgents,
  isLoading,
  onSelect,
}: ModelSelectorProps) {
  const navigate = useNavigate();
  const {
    open,
    search,
    triggerRef,
    menuPos,
    filteredGroups,
    setSearch,
    handleOpen,
    handleClose,
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
            : isLoading && !currentModel
              ? "Loading agents…"
              : currentModel?.displayName
                ?? (
                  hasAgents
                    ? CHAT_MODEL_SELECTOR_LABELS.empty
                    : null
                )
              ?? (
                !hasAgents
                  ? "No agents"
                  : "No runtime"
              )
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
            <div className={`flex w-72 flex-col overflow-hidden ${POPOVER_FRAME_CLASS}`}>
              <div className="border-b border-border px-2 pb-2 pt-2">
                <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                  <Search className="size-3.5 shrink-0 text-muted-foreground/60" />
                  <Input
                    variant="unstyled"
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
                    currentKind={currentModel?.kind ?? null}
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
                <PopoverMenuItem
                  density="compact"
                  onClick={() => {
                    handleClose();
                    // UX_SPEC §5: add-harness routes to Settings → Agents.
                    navigate(buildSettingsHref({ section: "agent-authentication" }));
                  }}
                  icon={<Plus className="size-3.5 shrink-0" />}
                  label={CHAT_MODEL_SELECTOR_LABELS.addHarness}
                  className="px-2.5 text-muted-foreground hover:text-popover-foreground"
                />
              </div>
            </div>
          </FixedPositionLayer>
        </>,
        document.body,
      )}
    </div>
  );
}

function ProviderModelGroup({
  group,
  currentKind,
  onSelect,
  showSeparator,
}: {
  group: ModelSelectorGroupData;
  currentKind: string | null;
  onSelect: (selection: ModelSelectorSelection) => void;
  showSeparator: boolean;
}) {
  const hasSelectedModel = group.models.some((model) => model.isSelected);

  return (
    <>
      {showSeparator && <div className="mx-2 my-1 border-t border-border/60" />}
      <div className="min-h-5 truncate px-2 py-0.5 text-sm font-[430] leading-4 text-muted-foreground/70">
        {group.providerDisplayName}
      </div>
      {group.models.map((model) => (
        <ModelRow
          key={model.modelId}
          kind={group.kind}
          displayName={model.displayName}
          isSelected={model.isSelected}
          showNewChatBadge={
            model.actionKind === "open_new_chat"
            && !model.isSelected
            && !hasSelectedModel
            && group.kind !== currentKind
          }
          onSelect={() => onSelect({ kind: group.kind, modelId: model.modelId })}
        />
      ))}
    </>
  );
}

function ModelRow({
  kind,
  displayName,
  isSelected,
  showNewChatBadge,
  onSelect,
}: {
  kind: string;
  displayName: string;
  isSelected: boolean;
  showNewChatBadge: boolean;
  onSelect: () => void;
}) {
  return (
    <PopoverMenuItem
      density="compact"
      onClick={onSelect}
      icon={<ProviderIcon kind={kind} className="size-3.5 shrink-0 text-muted-foreground" />}
      label={displayName}
      trailing={showNewChatBadge ? (
        <span className="shrink-0 text-xs text-muted-foreground/60">
          {CHAT_MODEL_SELECTOR_LABELS.newChatBadge}
        </span>
      ) : isSelected ? <Check className="size-3.5 shrink-0 text-foreground/60" /> : null}
      className="px-2.5 leading-[18px]"
      trailingClassName="size-auto opacity-100"
    />
  );
}
