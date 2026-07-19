import { useState, type ReactElement } from "react";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { PickerEmptyRow } from "@proliferate/ui/primitives/PickerPopoverContent";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import {
  Check,
  ChevronRight,
  FolderPlus,
  ProjectNotebook,
  X,
} from "@proliferate/ui/icons";
import { matchesPickerSearch } from "@proliferate/ui/utils/search";
import type { HomeNextDestination } from "#product/lib/domain/home/home-next-launch";
import type { SettingsRepositoryEntry } from "#product/lib/domain/settings/repositories";
import { ProjectSearchField } from "#product/components/home/screen/HomeTargetPickerParts";
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
  onAddRepository: () => void;
  side?: "top" | "bottom";
}
/**
 * The project menu shared by the hero heading's inline project trigger and
 * the target row's Project item (UX spec §1). One menu, two triggers.
 */
export function HomeProjectMenu({
  trigger,
  coworkAvailable,
  destination,
  repositories,
  selectedRepository,
  onSelectRepository,
  onSelectCowork,
  onAddRepository,
  side = "top",
}: HomeProjectMenuProps) {
  const [searchValue, setSearchValue] = useState("");
  const filteredRepositories = repositories.filter((repository) =>
    matchesPickerSearch([repository.name, repository.sourceRoot], searchValue)
  );
  return (
    <PopoverButton
      trigger={trigger}
      side={side}
      className={`w-72 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
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
                    close();
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
              onClick={() => {
                onAddRepository();
                setSearchValue("");
                close();
              }}
            />
            {coworkAvailable ? (
              <PopoverMenuItem
                icon={<X className="icon-paired" />}
                label="Don't work in a project"
                trailing={destination === "cowork" ? <Check className="icon-paired" /> : null}
                onClick={() => {
                  onSelectCowork();
                  setSearchValue("");
                  close();
                }}
              />
            ) : null}
          </div>
        </div>
      )}
    </PopoverButton>
  );
}
