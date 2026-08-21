import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { APP_ROUTES } from "#product/config/app-routes";
import { CHAT_MODEL_SELECTOR_LABELS } from "#product/copy/chat/chat-copy";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";
import { getSettingsSectionForHarnessKind } from "#product/lib/domain/settings/navigation-presentation";
import { splitProviderDisplayName } from "#product/lib/domain/chat/models/model-display-name-parts";
import type { ModelSelectorProps } from "#product/lib/domain/chat/models/model-selector-types";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";
import { PopoverButton } from "#product/primitives/PopoverButton";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";
import {
  PendingConfigIndicator,
  showsPendingConfigIndicator,
} from "#product/components/workspace/chat/input/PendingConfigIndicator";
import { ComposerFieldInlineError } from "#product/components/workspace/chat/input/ComposerFieldInlineError";
import { ComposerModelPickerPopover } from "#product/components/workspace/chat/input/ComposerModelPickerPopover";
import { useModelSupportStore } from "#product/stores/chat/model-support-store";
import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { focusChatInput } from "#product/lib/domain/focus-zone";

interface ComposerModelSelectorControlProps {
  modelSelectorProps: ModelSelectorProps;
  disabled?: boolean;
  keyboardShortcutEnabled?: boolean;
}

export function ComposerModelSelectorControl({
  modelSelectorProps,
  disabled = false,
  keyboardShortcutEnabled = false,
}: ComposerModelSelectorControlProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    connectionState,
    currentModel,
    groups,
    hasAgents,
    isLoading,
    onSelect,
    availability = "ready",
    unsupportedSelectionMessage = null,
  } = modelSelectorProps;
  // `observed_empty` deliberately stays ENABLED (owner revision r3): the picker
  // is that state's cure path, and greying out the one control that explains
  // what happened turns a recoverable state into a dead end. Only a missing or
  // failed observation disables the trigger — those have nothing to show.
  const selectorEnabled = !disabled
    && connectionState === "healthy"
    && !isLoading
    && hasAgents
    && availability !== "observation_pending"
    && availability !== "unavailable";
  // The picker opens itself after a refusal so the marked rows are in front of
  // the user rather than one click away. Nonce-driven: two refusals in a row
  // each reopen it, and nothing has to reset a flag.
  const pickerRequestNonce = useModelSupportStore((state) => state.pickerRequestNonce);
  const [pickerOpen, setPickerOpen] = useState(false);
  const restoreComposerFocusOnCloseRef = useRef(false);
  const keyboardFocusRestoreEnabled = keyboardShortcutEnabled
    && location.pathname === APP_ROUTES.home;
  useEffect(() => {
    if (pickerRequestNonce === 0) {
      return;
    }
    setPickerOpen(true);
  }, [pickerRequestNonce]);
  useShortcutHandler("workspace.open-model-selector", () => {
    if (pickerOpen && keyboardFocusRestoreEnabled) {
      restoreComposerFocusOnCloseRef.current = true;
    }
    setPickerOpen((open) => !open);
  }, {
    enabled: keyboardFocusRestoreEnabled && selectorEnabled,
    priority: "contextual",
  });
  const handleKeyboardClose = useCallback(() => {
    if (keyboardFocusRestoreEnabled) {
      restoreComposerFocusOnCloseRef.current = true;
    }
  }, [keyboardFocusRestoreEnabled]);
  useEffect(() => {
    if (pickerOpen || !restoreComposerFocusOnCloseRef.current) {
      return;
    }
    restoreComposerFocusOnCloseRef.current = false;
    if (keyboardFocusRestoreEnabled) {
      focusChatInput();
    }
  }, [keyboardFocusRestoreEnabled, pickerOpen]);
  const triggerLabel = resolveTriggerLabel(modelSelectorProps);
  // Stable qualification hook (attributes only): prefer the model whose
  // rendered identity matches the current chip. During live-config restore,
  // the requested launch row can remain selected while `currentModel` already
  // reflects the effective model reported by the running session. The hook
  // must describe the same effective model the user sees, then fall back to
  // the ordinary selected row when the live label has no unique catalog match.
  const modelsForCurrentKind = currentModel
    ? groups
      .filter((group) => group.kind === currentModel.kind)
      .flatMap((group) => group.models)
    : [];
  const effectiveModelMatches = currentModel
    ? modelsForCurrentKind.filter((model) => model.displayName === currentModel.displayName)
    : [];
  const selectedModelId = effectiveModelMatches.length === 1
    ? effectiveModelMatches[0].modelId
    : modelsForCurrentKind.find((model) => model.isSelected)?.modelId
      ?? groups.flatMap((group) => group.models).find((model) => model.isSelected)?.modelId
      ?? "";

  // UX_SPEC S5: adding a harness routes to Settings -> per-harness agent pages.
  const handleAddProvider = useCallback(() => {
    navigate(buildSettingsHref({ section: "agent-claude" }));
  }, [navigate]);

  const handleSettings = useCallback(() => {
    const section = currentModel
      ? getSettingsSectionForHarnessKind(currentModel.kind)
      : null;
    navigate(buildSettingsHref({ section: section ?? "agent-claude" }));
  }, [navigate, currentModel]);

  if (!selectorEnabled) {
    return (
      <ComposerControlButton
        disabled
        data-composer-model-trigger
        data-composer-selected-model={selectedModelId}
        icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="icon-control shrink-0 [font-size:var(--text-body)]" /> : undefined}
        label={triggerLabel}
        // 13px/450 composer control grammar: --text-ui is already 13px, so
        // only the weight is added here (the compact tier bakes it in).
        labelClassName="font-control"
        className="max-w-[min(15rem,100%)]"
      />
    );
  }

  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <PopoverButton
        trigger={(
          <ComposerControlButton
            emphasizeLabel
            data-composer-model-trigger
            data-composer-selected-model={selectedModelId}
            icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="icon-control shrink-0 [font-size:var(--text-body)]" /> : undefined}
            label={triggerLabel}
            labelClassName="font-control"
            trailing={showsPendingConfigIndicator(currentModel?.pendingState ?? null)
              ? <PendingConfigIndicator pendingState={currentModel?.pendingState ?? null} />
              : null}
            aria-label={`Model: ${triggerLabel}`}
            aria-invalid={unsupportedSelectionMessage ? true : undefined}
            aria-describedby={unsupportedSelectionMessage
              ? MODEL_UNSUPPORTED_MESSAGE_ID
              : undefined}
            onKeyDown={(event) => {
              // Escape from the closed trigger hands the caret back to the
              // editor: a refused Enter parks focus here, and Escape is how
              // the user says "not now" without losing their place.
              if (event.key !== "Escape" || pickerOpen || !keyboardFocusRestoreEnabled) {
                return;
              }
              event.preventDefault();
              focusChatInput();
            }}
            className="max-w-[min(15rem,100%)]"
          />
        )}
        side="top"
        align="start"
        offset={2}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
        externalOpen={pickerOpen}
        onOpenChange={setPickerOpen}
      >
        {(close) => (
          <ComposerModelPickerPopover
            groups={groups}
            availability={availability}
            currentModel={currentModel}
            onKeyboardClose={handleKeyboardClose}
            onSelect={(selection) => {
              onSelect(selection);
              close();
            }}
            onAddProvider={() => {
              handleAddProvider();
              close();
            }}
            onSettings={() => {
              handleSettings();
              close();
            }}
          />
        )}
      </PopoverButton>

      {/* Field-scoped, so it lives with the field: the model the composer is on
          is one this target refuses, and the control above is what fixes it. */}
      {unsupportedSelectionMessage && (
        <ComposerFieldInlineError id={MODEL_UNSUPPORTED_MESSAGE_ID}>
          {unsupportedSelectionMessage}
        </ComposerFieldInlineError>
      )}
    </span>
  );
}

const MODEL_UNSUPPORTED_MESSAGE_ID = "composer-model-unsupported";

function resolveTriggerLabel(modelSelectorProps: ModelSelectorProps): string {
  const {
    availability = "ready",
    connectionState,
    currentModel,
    hasAgents,
    isLoading,
  } = modelSelectorProps;

  if (connectionState === "connecting") {
    return "Connecting...";
  }
  // "Loading agents..." belongs to a genuine catalog HTTP read and nothing
  // else. An install in flight is not the catalog loading.
  if (isLoading && !currentModel) {
    return "Loading agents...";
  }
  if (currentModel?.displayName) {
    // Show only the leaf name on the pill — the provider icon already carries harness identity.
    return splitProviderDisplayName(currentModel.displayName).leaf;
  }
  // Before the first observation the disabled trigger reads "Select model":
  // "No agents" would be false (they are installing) and "Loading agents..."
  // would misname an install as a catalog fetch.
  if (availability === "observation_pending") {
    return CHAT_MODEL_SELECTOR_LABELS.empty;
  }
  if (!hasAgents) {
    return "No agents";
  }
  return CHAT_MODEL_SELECTOR_LABELS.empty;
}
