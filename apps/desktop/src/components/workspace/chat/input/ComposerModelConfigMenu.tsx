import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import { resolveComposerControlSubmenuLabel } from "@/lib/domain/chat/session-controls/composer-config-submenu-presentation";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import type {
  ModelSelectorGroup,
  ModelSelectorProps,
  ModelSelectorSelection,
} from "@/lib/domain/chat/models/model-selector-types";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import {
  ComposerMenuSeparator,
  ComposerModelPickerContent,
} from "./ComposerModelPickerList";
import {
  ComposerAddProviderRows,
  ComposerControlSubmenu,
  ComposerHarnessSubmenu,
  ComposerSubmenuMenuItem,
} from "./ComposerModelConfigSubmenus";

export type ComposerConfigSubmenu =
  | { kind: "harness" }
  | { kind: "control"; key: LiveSessionControlDescriptor["key"] };

export interface ComposerSubmenuPosition {
  left: number;
  top: number;
}

export function ComposerModelConfigMenu({
  activeKind,
  activeModelGroups,
  activeSubmenu,
  addProviderOpen,
  agentKind,
  filteredGroups,
  groups,
  menuRootRef,
  notReadyAgents,
  search,
  submenuControls,
  submenuPosition,
  submenuRef,
  onAddProviderOpenChange,
  onMenuMouseLeave,
  onOpenSubmenu,
  onSearchChange,
  onSelect,
  onSetupAgent,
  onClose,
}: {
  activeKind: string | null;
  activeModelGroups: ModelSelectorGroup[];
  activeSubmenu: ComposerConfigSubmenu | null;
  addProviderOpen: boolean;
  agentKind: string | null;
  filteredGroups: ModelSelectorGroup[];
  groups: ModelSelectorGroup[];
  menuRootRef: RefObject<HTMLDivElement | null>;
  notReadyAgents: ModelSelectorProps["notReadyAgents"];
  search: string;
  submenuControls: LiveSessionControlDescriptor[];
  submenuPosition: ComposerSubmenuPosition | null;
  submenuRef: RefObject<HTMLDivElement | null>;
  onAddProviderOpenChange: Dispatch<SetStateAction<boolean>>;
  onMenuMouseLeave: () => void;
  onOpenSubmenu: (submenu: ComposerConfigSubmenu, anchorElement: HTMLElement) => void;
  onSearchChange: (search: string) => void;
  onSelect: (selection: ModelSelectorSelection) => void;
  onSetupAgent: (agent: ModelSelectorProps["notReadyAgents"][number]) => void;
  onClose: () => void;
}) {
  const activeControl = activeSubmenu?.kind === "control"
    ? submenuControls.find((control) => control.key === activeSubmenu.key) ?? null
    : null;
  const showHarnessSubmenu = groups.length > 1;
  const showSubmenuRows = submenuControls.length > 0 || showHarnessSubmenu;

  return (
    <div
      ref={menuRootRef}
      className="relative w-72 max-w-[calc(100vw-1rem)]"
      onMouseLeave={onMenuMouseLeave}
    >
      <ComposerPopoverSurface className="w-72 max-w-[calc(100vw-1rem)] p-1">
        <div className="flex max-h-[min(20rem,calc(100vh-8rem))] min-h-0 flex-col">
          <ComposerModelPickerContent
            activeKind={activeKind}
            filteredGroups={filteredGroups}
            groups={activeModelGroups}
            search={search}
            onSearchChange={onSearchChange}
            onSelect={onSelect}
          />

          {(showSubmenuRows || notReadyAgents.length > 0) && (
            <div className="shrink-0">
              <ComposerMenuSeparator />

              {notReadyAgents.length > 0 && (
                <ComposerAddProviderRows
                  addProviderOpen={addProviderOpen}
                  notReadyAgents={notReadyAgents}
                  onAddProviderOpenChange={onAddProviderOpenChange}
                  onSetupAgent={onSetupAgent}
                />
              )}

              {showHarnessSubmenu && (
                <ComposerSubmenuMenuItem
                  active={activeSubmenu?.kind === "harness"}
                  label="Agent"
                  onOpen={(anchorElement) => onOpenSubmenu({ kind: "harness" }, anchorElement)}
                />
              )}

              {submenuControls.map((control) => (
                <ComposerSubmenuMenuItem
                  key={control.key}
                  active={activeSubmenu?.kind === "control" && activeSubmenu.key === control.key}
                  label={resolveComposerControlSubmenuLabel(control)}
                  onOpen={(anchorElement) => onOpenSubmenu({ kind: "control", key: control.key }, anchorElement)}
                />
              ))}
            </div>
          )}
        </div>
      </ComposerPopoverSurface>

      <div
        ref={submenuRef}
        className="absolute z-10"
        style={{
          left: submenuPosition?.left ?? 0,
          top: submenuPosition?.top ?? 0,
          visibility: activeSubmenu && submenuPosition === null ? "hidden" : undefined,
        }}
      >
        {activeSubmenu?.kind === "harness" && (
          <ComposerHarnessSubmenu
            activeKind={activeKind}
            groups={groups}
            onSelect={onSelect}
          />
        )}

        {activeControl && (
          <ComposerControlSubmenu
            agentKind={agentKind}
            control={activeControl}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
