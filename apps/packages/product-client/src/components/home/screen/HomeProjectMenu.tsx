import { useState, type ReactElement } from "react";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { PickerEmptyRow } from "#product/primitives/patterns/PickerPopoverContent";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import {
  Check,
  ChevronRight,
  X,
} from "#product/primitives/icons/core";
import {
  FolderPlus,
  ProjectNotebook,
} from "#product/primitives/icons/workspace";
import { matchesPickerSearch } from "#product/primitives/utils/search";
import type { HomeNextDestination } from "#product/lib/domain/home/home-next-launch";
import type { SettingsRepositoryEntry } from "#product/lib/domain/settings/repositories";
import { ProjectSearchField } from "#product/components/home/screen/HomeTargetPickerParts";
import { AddRepositoryFlowPanel } from "#product/components/workspace/repo-setup/AddRepositoryFlowPanel";
interface HomeProjectMenuProps {
  trigger: ReactElement<{
    onClick?: (...args: unknown[]) => void;
  }>;
  coworkAvailable: boolean;
  destination: HomeNextDestination;
  repositories: SettingsRepositoryEntry[];
  selectedRepository: SettingsRepositoryEntry | null;
  onSelectRepository: (sourceRoot: string) => void;
  onSelectCowork: () => void;
  side?: "top" | "bottom";
}
/**
 * The project menu shared by the hero heading's inline project trigger and
 * the target row's Project item (UX spec §1). One menu, two triggers.
 *
 * "New project" no longer closes the menu and raises a separate surface: the
 * menu sweeps sideways to the add-repository flow and back. Adding a project
 * is a continuation of choosing one, and the old close-then-reopen lost the
 * user's place — and, on the way back, their search.
 */
export function HomeProjectMenu({
  trigger,
  coworkAvailable,
  destination,
  repositories,
  selectedRepository,
  onSelectRepository,
  onSelectCowork,
  side = "top",
}: HomeProjectMenuProps) {
  return (
    <PopoverButton
      trigger={trigger}
      side={side}
      className={`w-72 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <HomeProjectMenuBody
          coworkAvailable={coworkAvailable}
          destination={destination}
          repositories={repositories}
          selectedRepository={selectedRepository}
          onSelectRepository={onSelectRepository}
          onSelectCowork={onSelectCowork}
          onClose={close}
        />
      )}
    </PopoverButton>
  );
}

function HomeProjectMenuBody({
  coworkAvailable,
  destination,
  repositories,
  selectedRepository,
  onSelectRepository,
  onSelectCowork,
  onClose,
}: {
  coworkAvailable: boolean;
  destination: HomeNextDestination;
  repositories: SettingsRepositoryEntry[];
  selectedRepository: SettingsRepositoryEntry | null;
  onSelectRepository: (sourceRoot: string) => void;
  onSelectCowork: () => void;
  onClose: () => void;
}) {
  const [searchValue, setSearchValue] = useState("");
  const [flowActive, setFlowActive] = useState(false);
  const filteredRepositories = repositories.filter((repository) =>
    matchesPickerSearch([repository.name, repository.sourceRoot], searchValue)
  );

  return (
    // The sweep: two full-width panels laid side by side in a track inside an
    // overflow-hidden viewport, moved by one transform. The track box stays
    // the menu's width and its panels overflow it, so one viewport-width step
    // (`-translate-x-full`) is exactly one panel. Reduced motion keeps both
    // positions and drops only the travel between them.
    <div
      data-slot="project-menu-sweep"
      className="w-full overflow-hidden"
    >
      <div
        className={`flex transition-transform duration-panel ease-out-quint motion-reduce:transition-none ${
          flowActive ? "-translate-x-full" : "translate-x-0"
        }`}
      >
        {/* `inert` rather than `aria-hidden`: the swept-out panel keeps its
            focusable rows, and hiding them from assistive tech while leaving
            them tabbable is worse than either. */}
        <div inert={flowActive} className="w-full shrink-0">
          <div className="flex max-h-[20rem] min-h-0 flex-col">
            <ProjectSearchField
              value={searchValue}
              onChange={setSearchValue}
            />
            <div className="min-h-0 overflow-y-auto py-1">
              {filteredRepositories.map((repository) => {
                const isSelected =
                  destination === "repository"
                  && selectedRepository?.sourceRoot === repository.sourceRoot;
                return (
                  <PopoverMenuItem
                    key={repository.sourceRoot}
                    data-repo-source-root={repository.sourceRoot}
                    icon={<ProjectNotebook className="icon-paired" />}
                    label={repository.name}
                    trailing={isSelected ? <Check className="icon-paired" /> : null}
                    onClick={() => {
                      onSelectRepository(repository.sourceRoot);
                      setSearchValue("");
                      onClose();
                    }}
                  />
                );
              })}
              {filteredRepositories.length === 0 ? (
                <PickerEmptyRow label="No projects found" />
              ) : null}
            </div>
            <div className="mx-1 my-1 border-t border-border/70" />
            <div className="pb-1">
              <PopoverMenuItem
                icon={<FolderPlus className="icon-paired" />}
                label="New project"
                trailing={<ChevronRight className="icon-paired" />}
                // Held open, not just hovered: while the flow panel is showing,
                // this row is what the user is inside of.
                className={flowActive ? "bg-hover" : undefined}
                onClick={() => setFlowActive((active) => !active)}
              />
              {coworkAvailable ? (
                <PopoverMenuItem
                  icon={<X className="icon-paired" />}
                  label="Don't work in a project"
                  trailing={destination === "cowork" ? <Check className="icon-paired" /> : null}
                  onClick={() => {
                    onSelectCowork();
                    setSearchValue("");
                    onClose();
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
        <div inert={!flowActive} className="w-full shrink-0">
          {flowActive ? (
            <AddRepositoryFlowPanel
              onClose={onClose}
              onExitEntry={() => setFlowActive(false)}
              entryTitle="New project"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
