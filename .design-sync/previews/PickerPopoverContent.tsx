import { useState } from "react";
import {
  Check,
  GitBranch,
  PickerPopoverContent,
  PopoverMenuItem,
  Server,
} from "@proliferate/ui";

const SURFACE =
  "w-72 rounded-xl border border-border bg-popover text-popover-foreground shadow-popover";

const BRANCHES = [
  "main",
  "claude/design-sync-ui-import",
  "release/2026.07",
  "fix/sandbox-idle-timeout",
  "feat/model-catalog-table",
];

export const BranchPicker = () => {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("claude/design-sync-ui-import");
  const matches = BRANCHES.filter((branch) =>
    branch.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className={SURFACE}>
      <PickerPopoverContent
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search branches"
        emptyLabel="No branches match"
        bodyClassName="px-1"
      >
        {matches.map((branch) => (
          <PopoverMenuItem
            key={branch}
            icon={<GitBranch className="icon-paired" />}
            label={branch}
            trailing={branch === selected ? <Check className="icon-paired" /> : null}
            onClick={() => setSelected(branch)}
          />
        ))}
      </PickerPopoverContent>
    </div>
  );
};

export const FilteredSearch = () => {
  const [search, setSearch] = useState("sandbox");
  const matches = BRANCHES.filter((branch) =>
    branch.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className={SURFACE}>
      <PickerPopoverContent
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search branches"
        emptyLabel="No branches match"
        bodyClassName="px-1"
      >
        {matches.map((branch) => (
          <PopoverMenuItem
            key={branch}
            icon={<GitBranch className="icon-paired" />}
            label={branch}
            onClick={() => {}}
          />
        ))}
      </PickerPopoverContent>
    </div>
  );
};

export const EmptyResults = () => {
  const [search, setSearch] = useState("staging-eu");
  return (
    <div className={SURFACE}>
      <PickerPopoverContent
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search environments"
        emptyLabel="No environments match “staging-eu”"
        bodyClassName="px-1"
      >
        {null}
      </PickerPopoverContent>
    </div>
  );
};

export const WithoutSearch = () => (
  <div className={SURFACE}>
    <PickerPopoverContent bodyClassName="px-1">
      <PopoverMenuItem
        icon={<Server className="icon-paired" />}
        label="Cloud sandbox"
        trailing={<Check className="icon-paired" />}
        onClick={() => {}}
      />
      <PopoverMenuItem icon={<Server className="icon-paired" />} label="Local runtime" onClick={() => {}} />
      <PopoverMenuItem icon={<Server className="icon-paired" />} label="SSH target — build-01" onClick={() => {}} />
    </PickerPopoverContent>
  </div>
);
