import { useState } from "react";
import { Badge, CheckboxPrimitive, Label } from "@proliferate/ui";

/**
 * CheckboxPrimitive is the unstyled-by-consumer Radix root the styled
 * `Checkbox` recipe is built from: a 16px square that carries only the input
 * border, the primary fill on `data-[state=checked]`, and the Check indicator.
 * Every cell here is about that primitive's own contract.
 */

export const States = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <CheckboxPrimitive checked />
      <span className="text-ui text-foreground">checked — bg-primary fill</span>
    </div>
    <div className="flex items-center gap-2">
      <CheckboxPrimitive checked={false} />
      <span className="text-ui text-foreground">unchecked — border-input only</span>
    </div>
    <div className="flex items-center gap-2">
      <CheckboxPrimitive checked="indeterminate" />
      <span className="text-ui text-foreground">
        indeterminate — glyph without the fill
      </span>
    </div>
    <div className="flex items-center gap-2">
      <CheckboxPrimitive checked disabled />
      <span className="text-ui text-foreground">disabled · checked</span>
    </div>
    <div className="flex items-center gap-2">
      <CheckboxPrimitive checked={false} disabled />
      <span className="text-ui text-foreground">disabled · unchecked</span>
    </div>
  </div>
);

/** The root merges a consumer className, so size and radius are overridable. */
export const SizeOverrides = () => (
  <div className="flex items-end gap-6">
    <div className="flex flex-col items-center gap-2">
      <CheckboxPrimitive checked className="size-3" />
      <span className="text-ui-sm text-muted-foreground">size-3</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <CheckboxPrimitive checked />
      <span className="text-ui-sm text-muted-foreground">default (size-4)</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <CheckboxPrimitive checked className="size-6" />
      <span className="text-ui-sm text-muted-foreground">size-6</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <CheckboxPrimitive checked className="size-6 rounded-full" />
      <span className="text-ui-sm text-muted-foreground">size-6 · rounded-full</span>
    </div>
  </div>
);

const REPOS = [
  { id: "proliferate", name: "proliferate-ai/proliferate", branch: "main", initial: true },
  { id: "anyharness", name: "proliferate-ai/anyharness", branch: "main", initial: true },
  { id: "cloud-sdk", name: "proliferate-ai/cloud-sdk", branch: "release/0.7", initial: false },
  { id: "dotfiles", name: "pablo-hansen/dotfiles", branch: "master", initial: false },
];

export const RepoSelectionList = () => {
  const [selected, setSelected] = useState(() =>
    REPOS.filter((repo) => repo.initial).map((repo) => repo.id),
  );
  const allSelected = selected.length === REPOS.length;
  const headerState = allSelected
    ? true
    : selected.length === 0
      ? false
      : "indeterminate";
  return (
    <div className="w-96 rounded-lg border border-border bg-surface-elevated">
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <CheckboxPrimitive
          id="repo-all"
          checked={headerState}
          onCheckedChange={(value) =>
            setSelected(value === true ? REPOS.map((repo) => repo.id) : [])
          }
        />
        <Label htmlFor="repo-all" className="mb-0 text-ui text-foreground">
          Cloud environments
        </Label>
        <Badge tone="neutral" className="ml-auto">
          {selected.length} of {REPOS.length}
        </Badge>
      </div>
      <div className="flex flex-col gap-3 px-3 py-3">
        {REPOS.map((repo) => (
          <div key={repo.id} className="flex items-center gap-2">
            <CheckboxPrimitive
              id={`repo-${repo.id}`}
              checked={selected.includes(repo.id)}
              onCheckedChange={(value) =>
                setSelected((current) =>
                  value === true
                    ? [...current, repo.id]
                    : current.filter((id) => id !== repo.id),
                )
              }
            />
            <Label htmlFor={`repo-${repo.id}`} className="mb-0 min-w-0 text-ui text-foreground">
              <span className="truncate">{repo.name}</span>
            </Label>
            <span className="ml-auto shrink-0 font-mono text-ui-sm text-muted-foreground">
              {repo.branch}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
