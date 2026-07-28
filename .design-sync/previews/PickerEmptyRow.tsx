import {
  Check,
  GitBranch,
  PickerEmptyRow,
  PickerPopoverContent,
  PopoverMenuItem,
  Server,
} from "@proliferate/ui";

// PickerEmptyRow is the one-line placeholder every picker body drops in when a
// section has nothing to list — so each cell renders it inside the popover
// surface + PickerPopoverContent it ships in.
const SURFACE =
  "w-72 rounded-xl border border-border bg-popover text-popover-foreground shadow-popover";

export const NoBranchesFound = () => (
  <div className={SURFACE}>
    <PickerPopoverContent
      searchValue="staging-eu"
      searchPlaceholder="Search branches"
      onSearchChange={() => {}}
      bodyClassName="px-1"
    >
      <PickerEmptyRow label="No branches found" />
    </PickerPopoverContent>
  </div>
);

export const LoadingBranches = () => (
  <div className={SURFACE}>
    <PickerPopoverContent
      searchValue=""
      searchPlaceholder="Search branches"
      onSearchChange={() => {}}
      bodyClassName="px-1"
    >
      <PickerEmptyRow label="Loading branches" />
    </PickerPopoverContent>
  </div>
);

export const EmptySectionBelowRows = () => (
  <div className={SURFACE}>
    <PickerPopoverContent bodyClassName="px-1">
      <div className="px-2.5 pb-1 pt-1.5 text-ui-sm font-medium text-faint">
        Base branch
      </div>
      <PopoverMenuItem
        icon={<GitBranch className="icon-paired" />}
        label="main"
        trailing={<Check className="icon-paired" />}
        onClick={() => {}}
      />
      <PopoverMenuItem
        icon={<GitBranch className="icon-paired" />}
        label="release/2026.07"
        onClick={() => {}}
      />
      <div className="mt-1 px-2.5 pb-1 pt-1.5 text-ui-sm font-medium text-faint">
        Cloud targets
      </div>
      <PickerEmptyRow label="No cloud environments configured" />
    </PickerPopoverContent>
  </div>
);

export const EmptyTargetPicker = () => (
  <div className={SURFACE}>
    <PickerPopoverContent
      searchValue="us-east"
      searchPlaceholder="Search environments"
      onSearchChange={() => {}}
      bodyClassName="px-1"
    >
      <PopoverMenuItem
        icon={<Server className="icon-paired" />}
        label="sandbox-us-east-2"
        onClick={() => {}}
      />
      <PickerEmptyRow label="No other environments match “us-east”" />
    </PickerPopoverContent>
  </div>
);
