import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentSetupModal } from "@/components/agents/AgentSetupModal";
import { CHAT_MODEL_SELECTOR_LABELS } from "@/copy/chat/chat-copy";
import { summarizeComposerModelConfigControls } from "@/lib/domain/chat/session-controls/composer-control-groups";
import { sortComposerConfigSubmenuControls } from "@/lib/domain/chat/session-controls/composer-config-submenu-presentation";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import {
  filterComposerModelGroups,
} from "@/lib/domain/chat/models/model-selector-filtering";
import type { ModelSelectorProps } from "@/lib/domain/chat/models/model-selector-types";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { ChevronDown } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import {
  ComposerModelConfigMenu,
  type ComposerConfigSubmenu,
  type ComposerSubmenuPosition,
} from "./ComposerModelConfigMenu";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

interface ComposerModelConfigSelectorProps {
  modelSelectorProps: ModelSelectorProps;
  agentKind: string | null;
  controls: LiveSessionControlDescriptor[];
}

const COMPOSER_SUBMENU_GAP_PX = 4;
const COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX = 8;
// Crossing the gap between the menu and its submenu briefly leaves both
// elements; closing must survive that traversal.
const COMPOSER_SUBMENU_CLOSE_GRACE_MS = 150;

export function ComposerModelConfigSelector({
  modelSelectorProps,
  agentKind,
  controls,
}: ComposerModelConfigSelectorProps) {
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<ComposerConfigSubmenu | null>(null);
  const [submenuAnchorTop, setSubmenuAnchorTop] = useState<number | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState<ComposerSubmenuPosition | null>(null);
  const [setupAgent, setSetupAgent] = useState<ModelSelectorProps["notReadyAgents"][number] | null>(null);
  const submenuCloseTimerRef = useRef<number | null>(null);

  const cancelPendingSubmenuClose = useCallback(() => {
    if (submenuCloseTimerRef.current !== null) {
      window.clearTimeout(submenuCloseTimerRef.current);
      submenuCloseTimerRef.current = null;
    }
  }, []);

  const scheduleSubmenuClose = useCallback(() => {
    cancelPendingSubmenuClose();
    submenuCloseTimerRef.current = window.setTimeout(() => {
      submenuCloseTimerRef.current = null;
      setActiveSubmenu(null);
    }, COMPOSER_SUBMENU_CLOSE_GRACE_MS);
  }, [cancelPendingSubmenuClose]);

  useEffect(() => cancelPendingSubmenuClose, [cancelPendingSubmenuClose]);

  const {
    connectionState,
    currentModel,
    groups,
    hasAgents,
    isLoading,
    notReadyAgents,
    onSelect,
  } = modelSelectorProps;
  const selectorEnabled = connectionState === "healthy" && !isLoading && hasAgents;
  const activeKind = currentModel?.kind ?? null;
  const activeGroup = activeKind
    ? groups.find((group) => group.kind === activeKind) ?? null
    : groups[0] ?? null;
  const activeModelGroups = useMemo(
    () => activeGroup ? [activeGroup] : [],
    [activeGroup],
  );
  const triggerLabel = resolveTriggerLabel(modelSelectorProps);
  const triggerDetail = summarizeComposerModelConfigControls(agentKind, controls);
  const pendingState =
    currentModel?.pendingState
    ?? controls.find((control) => control.pendingState)?.pendingState
    ?? null;
  const filteredGroups = useMemo(
    () => filterComposerModelGroups(activeModelGroups, search),
    [activeModelGroups, search],
  );
  const submenuControls = useMemo(
    () => sortComposerConfigSubmenuControls(controls),
    [controls],
  );

  useLayoutEffect(() => {
    if (!activeSubmenu) {
      setSubmenuAnchorTop(null);
      setSubmenuPosition(null);
      return;
    }

    const updateSubmenuPosition = () => {
      const root = menuRootRef.current;
      const submenu = submenuRef.current;
      if (!root || !submenu) {
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const submenuRect = submenu.getBoundingClientRect();
      const viewportLeft = window.visualViewport?.offsetLeft ?? 0;
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const viewportRight = viewportLeft + (
        window.visualViewport?.width
        ?? document.documentElement.clientWidth
        ?? window.innerWidth
      );
      const viewportBottom = viewportTop + (
        window.visualViewport?.height
        ?? document.documentElement.clientHeight
        ?? window.innerHeight
      );
      const preferredRightLeft = rootRect.width + COMPOSER_SUBMENU_GAP_PX;
      const preferredLeftLeft = -submenuRect.width - COMPOSER_SUBMENU_GAP_PX;
      const rightFits = rootRect.right + COMPOSER_SUBMENU_GAP_PX + submenuRect.width
        <= viewportRight - COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX;
      const leftFits = rootRect.left - COMPOSER_SUBMENU_GAP_PX - submenuRect.width
        >= viewportLeft + COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX;
      const preferredLeft = rightFits || !leftFits ? preferredRightLeft : preferredLeftLeft;
      const minLeft = viewportLeft + COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX - rootRect.left;
      const maxLeft = viewportRight
        - COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX
        - rootRect.left
        - submenuRect.width;
      const preferredTop = submenuAnchorTop ?? 0;
      const minTop = viewportTop + COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX - rootRect.top;
      const maxTop = viewportBottom
        - COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX
        - rootRect.top
        - submenuRect.height;

      setSubmenuPosition({
        left: clamp(
          preferredLeft,
          Math.min(minLeft, maxLeft),
          Math.max(minLeft, maxLeft),
        ),
        top: clamp(
          preferredTop,
          Math.min(minTop, maxTop),
          Math.max(minTop, maxTop),
        ),
      });
    };

    updateSubmenuPosition();
    window.addEventListener("resize", updateSubmenuPosition);
    return () => window.removeEventListener("resize", updateSubmenuPosition);
  }, [activeSubmenu, submenuAnchorTop]);

  if (!selectorEnabled) {
    return (
      <ComposerControlButton
        disabled
        tone="quiet"
        icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="size-4 shrink-0" /> : undefined}
        label={triggerLabel}
        detail={triggerDetail}
        className="max-w-[15rem]"
      />
    );
  }

  return (
    <>
      <PopoverButton
        trigger={(
          <ComposerControlButton
            icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="size-4 shrink-0" /> : undefined}
            label={triggerLabel}
            detail={triggerDetail}
            trailing={(
              <span className="flex items-center gap-1">
                <PendingConfigIndicator pendingState={pendingState} />
                <ChevronDown className="size-3 shrink-0 text-[color:var(--color-composer-control-muted-foreground)]" />
              </span>
            )}
            aria-label={`Model and configuration: ${triggerLabel}${triggerDetail ? `, ${triggerDetail}` : ""}`}
            className="max-w-[18rem]"
          />
        )}
        side="top"
        align="end"
        offset={2}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
        onOpenChange={(open) => {
          if (!open) {
            cancelPendingSubmenuClose();
            resetMenuState({
              setActiveSubmenu,
              setAddProviderOpen,
              setSearch,
              setSubmenuAnchorTop,
              setSubmenuPosition,
            });
          }
        }}
      >
        {(close) => (
          <ComposerModelConfigMenu
            activeKind={activeKind}
            activeModelGroups={activeModelGroups}
            activeSubmenu={activeSubmenu}
            addProviderOpen={addProviderOpen}
            agentKind={agentKind}
            filteredGroups={filteredGroups}
            groups={groups}
            menuRootRef={menuRootRef}
            notReadyAgents={notReadyAgents}
            search={search}
            submenuControls={submenuControls}
            submenuPosition={submenuPosition}
            submenuRef={submenuRef}
            onAddProviderOpenChange={setAddProviderOpen}
            onClose={close}
            onMenuMouseEnter={cancelPendingSubmenuClose}
            onMenuMouseLeave={scheduleSubmenuClose}
            onOpenSubmenu={(submenu, anchorElement) => {
              cancelPendingSubmenuClose();
              setAddProviderOpen(false);
              setSubmenuPosition(null);
              setSubmenuAnchorTop(resolveSubmenuAnchorTop(menuRootRef.current, anchorElement));
              setActiveSubmenu(submenu);
            }}
            onSearchChange={setSearch}
            onSelect={(selection) => {
              onSelect(selection);
              close();
            }}
            onSetupAgent={setSetupAgent}
          />
        )}
      </PopoverButton>

      {setupAgent && (
        <AgentSetupModal
          agent={setupAgent}
          onClose={() => setSetupAgent(null)}
        />
      )}
    </>
  );
}

function resetMenuState({
  setActiveSubmenu,
  setAddProviderOpen,
  setSearch,
  setSubmenuAnchorTop,
  setSubmenuPosition,
}: {
  setActiveSubmenu: (value: ComposerConfigSubmenu | null) => void;
  setAddProviderOpen: (value: boolean) => void;
  setSearch: (value: string) => void;
  setSubmenuAnchorTop: (value: number | null) => void;
  setSubmenuPosition: (value: ComposerSubmenuPosition | null) => void;
}) {
  setSearch("");
  setAddProviderOpen(false);
  setActiveSubmenu(null);
  setSubmenuAnchorTop(null);
  setSubmenuPosition(null);
}

function resolveSubmenuAnchorTop(
  root: HTMLElement | null,
  anchorElement: HTMLElement,
): number {
  if (!root) {
    return 0;
  }
  const rootRect = root.getBoundingClientRect();
  const anchorRect = anchorElement.getBoundingClientRect();
  return anchorRect.top - rootRect.top;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveTriggerLabel(modelSelectorProps: ModelSelectorProps): string {
  const {
    connectionState,
    currentModel,
    hasAgents,
    isLoading,
  } = modelSelectorProps;

  if (connectionState === "connecting") {
    return "Connecting...";
  }
  if (isLoading && !currentModel) {
    return "Loading agents...";
  }
  if (currentModel?.displayName) {
    return currentModel.displayName;
  }
  if (!hasAgents) {
    return "No agents";
  }
  return CHAT_MODEL_SELECTOR_LABELS.empty;
}
