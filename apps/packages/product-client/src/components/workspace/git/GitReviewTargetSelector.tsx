import { useMemo, useState } from "react";
import type { GitBranchRef } from "@anyharness/sdk";
import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { Check, ChevronDown } from "#product/primitives/icons/core";
import { GitBranchIcon } from "#product/primitives/icons/workspace-git";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import {
  PickerEmptyRow,
  PickerPopoverContent,
} from "#product/primitives/patterns/PickerPopoverContent";
import type { GitPanelMode } from "#product/lib/domain/workspaces/changes/git-panel-diff";
import { GIT_REVIEW_SELECTOR_TRIGGER_CLASS } from "#product/components/workspace/git/GitReviewSelectorChrome";

export function GitReviewTargetSelector({
  mode,
  baseRef,
  branchRefs,
  isRuntimeReady,
  onSelect,
}: {
  mode: GitPanelMode;
  baseRef: string | null;
  branchRefs: readonly GitBranchRef[];
  isRuntimeReady: boolean;
  onSelect: (baseRef: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const activeRef = baseRef ?? "origin/main";
  const localTarget = localTargetForMode(mode);
  const branchOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    const options = branchRefs
      .filter((branch) => !query || branch.name.toLowerCase().includes(query))
      .slice(0, 40);
    if (activeRef && !options.some((branch) => branch.name === activeRef)) {
      return [{
        name: activeRef,
        isDefault: false,
        isHead: false,
        isRemote: activeRef.includes("/"),
        upstream: null,
      } satisfies GitBranchRef, ...options];
    }
    return options;
  }, [activeRef, branchRefs, search]);

  if (localTarget) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        // C4: caps the trigger label at 9rem — narrower than the base
        // selector's 11rem because this trigger never carries a count chip,
        // so it can sit tighter against the review header's other chrome.
        className={`${GIT_REVIEW_SELECTOR_TRIGGER_CLASS} w-fit max-w-[9rem] shrink-0 cursor-default opacity-100 disabled:opacity-100`}
      >
        <span className="min-w-0 truncate text-sidebar-foreground">{localTarget.label}</span>
      </Button>
    );
  }

  return (
    <PopoverButton
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!isRuntimeReady}
          // C4: see the disabled `localTarget` trigger above — same cap,
          // same reasoning.
          className={`${GIT_REVIEW_SELECTOR_TRIGGER_CLASS} w-fit max-w-[9rem] shrink-0`}
        >
          <span className="min-w-0 truncate text-sidebar-foreground">{activeRef}</span>
          <ChevronDown className="icon-compact shrink-0 text-sidebar-muted-foreground" />
        </Button>
      }
      align="start"
      className={`w-56 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        // `max-h-64` keeps this picker's original 16rem cap rather than the
        // pattern's 20rem default; the cap now bounds the whole picker
        // (search row included) instead of the scrolling list alone.
        <PickerPopoverContent
          className="max-h-64"
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search branches"
          searchAriaLabel="Search branches"
          searchAutoFocus
        >
          {branchOptions.length === 0 ? (
            <PickerEmptyRow label="No branches" />
          ) : (
            branchOptions.map((branch) => (
              <PopoverMenuItem
                key={branch.name}
                icon={<GitBranchIcon />}
                label={branch.name}
                labelClassName={
                  branch.name === activeRef ? "text-foreground" : "text-muted-foreground"
                }
                trailing={(
                  <span className="flex shrink-0 items-center gap-2">
                    {branch.isDefault && <Badge size="micro">default</Badge>}
                    {branch.name === activeRef && (
                      <Check className="icon-compact shrink-0 text-foreground" />
                    )}
                  </span>
                )}
                onClick={() => {
                  onSelect(branch.name);
                  close();
                }}
              />
            ))
          )}
        </PickerPopoverContent>
      )}
    </PopoverButton>
  );
}

function localTargetForMode(mode: GitPanelMode) {
  if (mode === "staged") {
    return { label: "HEAD" };
  }
  if (mode === "unstaged" || mode === "working_tree_composite") {
    return { label: "Working tree" };
  }
  return null;
}
