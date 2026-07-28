import { useState, type ReactNode } from "react";
import {
  Check,
  GitBranch,
  PickerEmptyRow,
  PopoverMenuItem,
  PopoverSearchField,
} from "@proliferate/ui";

/**
 * The field is designed to sit directly on a popover surface with a hairline
 * divider below it — never as a boxed field — so every cell composes it inside
 * that surface, the way PickerPopoverContent does in the product.
 */
function PickerSurface({ children }: { children: ReactNode }) {
  return (
    <div className="w-72 select-none rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-popover">
      {children}
    </div>
  );
}

const BRANCHES = [
  "main",
  "claude/design-sync-ui-import",
  "feat/settings-flat-rows",
  "fix/popover-focus-neutrality",
  "release/0.4.2",
];

function BranchPicker({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const matches = BRANCHES.filter((branch) =>
    branch.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <PickerSurface>
      <PopoverSearchField
        value={query}
        onChange={setQuery}
        placeholder="Search branches"
        ariaLabel="Search branches"
      />
      <div className="my-1 border-t border-border-light" />
      <div className="flex flex-col">
        {matches.length === 0 ? (
          <PickerEmptyRow label="No branches match" />
        ) : (
          matches.map((branch) => (
            <PopoverMenuItem
              key={branch}
              label={branch}
              icon={<GitBranch />}
              trailing={branch === "main" ? <Check className="icon-paired" /> : undefined}
              onClick={() => setQuery(query)}
            />
          ))
        )}
      </div>
    </PickerSurface>
  );
}

export const InBranchPicker = () => <BranchPicker initialQuery="" />;

export const WithQuery = () => <BranchPicker initialQuery="claude" />;

export const NoMatches = () => <BranchPicker initialQuery="kubernetes" />;

export const Placeholders = () => {
  const [repo, setRepo] = useState("");
  const [environment, setEnvironment] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <PickerSurface>
        <PopoverSearchField
          value={repo}
          onChange={setRepo}
          placeholder="Search repositories"
        />
      </PickerSurface>
      <PickerSurface>
        <PopoverSearchField
          value={environment}
          onChange={setEnvironment}
          placeholder="Search environments"
        />
      </PickerSurface>
    </div>
  );
};
