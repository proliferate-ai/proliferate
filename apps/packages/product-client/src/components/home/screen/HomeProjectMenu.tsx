import { useState, type ReactElement } from "react";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { PickerEmptyRow } from "#product/primitives/patterns/PickerPopoverContent";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import {
  Check,
  ChevronRight,
} from "#product/primitives/icons/core";
import {
  FolderPlus,
  ProjectNotebook,
} from "#product/primitives/icons/workspace";
import { matchesPickerSearch } from "#product/primitives/utils/search";
import type { SettingsRepositoryEntry } from "#product/lib/domain/settings/repositories";
import { ProjectSearchField } from "#product/components/home/screen/HomeTargetPickerParts";
interface HomeProjectMenuProps {
  trigger: ReactElement<{
    onClick?: (...args: unknown[]) => void;
  }>;
  repositories: SettingsRepositoryEntry[];
  selectedRepository: SettingsRepositoryEntry | null;
  onSelectRepository: (sourceRoot: string) => void;
  onAddRepository: () => void;
  side?: "top" | "bottom";
}
/**
 * The project menu shared by the hero heading's inline project trigger and
 * the target row's Project item (UX spec §1). One menu, two triggers.
 */
export function HomeProjectMenu({
  trigger,
  repositories,
  selectedRepository,
  onSelectRepository,
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
                selectedRepository?.sourceRoot === repository.sourceRoot;
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
          </div>
        </div>
      )}
    </PopoverButton>
  );
}
