import { useMemo, useState } from "react";
import { PickerEmptyRow, PickerPopoverContent } from "@/components/ui/PickerPopoverContent";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import {
  Check,
  CloudIcon,
  FolderOpen,
  Plus,
} from "@/components/ui/icons";
import {
  type AutomationTargetGroup,
  type AutomationTargetRow,
  type AutomationTargetSelection,
} from "@/lib/domain/automations/target-selection";
import { matchesPickerSearch } from "@/lib/infra/search/search";

interface AutomationTargetPickerProps {
  groups: AutomationTargetGroup[];
  selectedRow: Extract<AutomationTargetRow, { kind: "target" }> | null;
  isLoading: boolean;
  disabledReason: string | null;
  onSelect: (target: AutomationTargetSelection) => void;
  onConfigureCloud: (target: { gitOwner: string; gitRepoName: string }) => void;
}

const POPOVER_CLASS = "w-80 rounded-xl border border-border bg-popover p-1 shadow-floating";

export function AutomationTargetPicker({
  groups,
  selectedRow,
  isLoading,
  disabledReason,
  onSelect,
  onConfigureCloud,
}: AutomationTargetPickerProps) {
  const [searchValue, setSearchValue] = useState("");
  const filteredGroups = useMemo(() => {
    return groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) =>
          matchesPickerSearch([
            group.repoLabel,
            row.label,
            row.description ?? "",
            row.kind === "configureCloud" ? row.gitOwner : row.target.gitOwner,
            row.kind === "configureCloud" ? row.gitRepoName : row.target.gitRepoName,
          ], searchValue)
        ),
      }))
      .filter((group) => group.rows.length > 0);
  }, [groups, searchValue]);

  const triggerLabel = selectedRow?.repoLabel
    ?? (isLoading ? "Loading targets" : "Select target");
  const triggerDetail = selectedRow?.label ?? null;

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          aria-label="Automation target"
          disabled={isLoading || groups.length === 0}
          icon={selectedRow?.target.executionTarget === "cloud"
            ? <CloudIcon className="size-3.5 shrink-0 text-muted-foreground" />
            : <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />}
          label={triggerLabel}
          detail={triggerDetail}
          disclosure
          className="max-w-[18rem]"
        />
      )}
      side="top"
      className={POPOVER_CLASS}
    >
      {(close) => (
        <PickerPopoverContent
          searchValue={searchValue}
          searchPlaceholder="Search targets"
          onSearchChange={setSearchValue}
        >
          {filteredGroups.length === 0 ? (
            <PickerEmptyRow
              label={isLoading ? "Loading targets" : disabledReason ?? "No targets found"}
            />
          ) : (
            filteredGroups.map((group, index) => (
              <div key={group.repoKey}>
                {index > 0 ? <div className="my-1 h-px bg-border" /> : null}
                <div className="px-2.5 pb-1 pt-1.5 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground/60">
                  {group.repoLabel}
                </div>
                {group.rows.map((row) =>
                  row.kind === "target" ? (
                    <PopoverMenuItem
                      key={row.id}
                      icon={row.target.executionTarget === "cloud"
                        ? <CloudIcon className="size-3.5 text-muted-foreground" />
                        : <FolderOpen className="size-3.5 text-muted-foreground" />}
                      label={row.label}
                      disabled={!!row.disabledReason}
                      trailing={row.selected ? <Check className="size-3.5 text-foreground/70" /> : null}
                      onClick={() => {
                        if (row.disabledReason) return;
                        onSelect(row.target);
                        setSearchValue("");
                        close();
                      }}
                    >
                      {row.description || row.disabledReason ? (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {row.disabledReason ?? row.description}
                        </span>
                      ) : null}
                    </PopoverMenuItem>
                  ) : (
                    <PopoverMenuItem
                      key={row.id}
                      icon={<Plus className="size-3.5 text-muted-foreground" />}
                      label={row.label}
                      onClick={() => {
                        onConfigureCloud({
                          gitOwner: row.gitOwner,
                          gitRepoName: row.gitRepoName,
                        });
                        setSearchValue("");
                        close();
                      }}
                    >
                      {row.description ? (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {row.description}
                        </span>
                      ) : null}
                    </PopoverMenuItem>
                  )
                )}
              </div>
            ))
          )}
        </PickerPopoverContent>
      )}
    </PopoverButton>
  );
}
