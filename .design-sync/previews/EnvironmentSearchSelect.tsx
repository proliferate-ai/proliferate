import { useEffect, useRef, useState } from "react";
import {
  EnvironmentSearchSelect,
  CloudIcon,
  GitBranch,
} from "@proliferate/ui";

const BRANCHES = [
  { id: "main", label: "main", detail: "default · updated 4 minutes ago" },
  { id: "claude/design-sync-ui-import", label: "claude/design-sync-ui-import", detail: "ahead 3 · behind 0" },
  { id: "release/2026.07", label: "release/2026.07", detail: "protected" },
  { id: "fix/capture-viewport", label: "fix/capture-viewport", detail: "merged" },
];

export const BranchPicker = () => {
  const [selected, setSelected] = useState("main");
  return (
    <div className="w-full max-w-md">
      <div className="mb-2 text-ui-sm text-muted-foreground">Default branch</div>
      <EnvironmentSearchSelect
        label={selected}
        searchPlaceholder="Search branches"
        emptyLabel="No branches found"
        options={BRANCHES.map((branch) => ({
          id: branch.id,
          label: branch.label,
          detail: branch.detail,
          selected: selected === branch.id,
          onSelect: () => setSelected(branch.id),
        }))}
      />
    </div>
  );
};

export const WithLeadingIcon = () => {
  const [selected, setSelected] = useState("sandbox-us-east-2");
  const environments = [
    { id: "sandbox-us-east-2", label: "sandbox-us-east-2", detail: "8 vCPU · 32 GB · warm" },
    { id: "staging", label: "staging", detail: "4 vCPU · 16 GB" },
    { id: "prod", label: "prod", detail: "read-only for agents" },
  ];
  return (
    <div className="w-full max-w-md">
      <div className="mb-2 text-ui-sm text-muted-foreground">Cloud environment</div>
      <EnvironmentSearchSelect
        label={selected}
        searchPlaceholder="Search environments"
        emptyLabel="No environments"
        leading={<CloudIcon className="icon-paired shrink-0 text-muted-foreground" />}
        options={environments.map((environment) => ({
          id: environment.id,
          label: environment.label,
          detail: environment.detail,
          selected: selected === environment.id,
          onSelect: () => setSelected(environment.id),
        }))}
      />
    </div>
  );
};

export const Disabled = () => (
  <div className="w-full max-w-md">
    <div className="mb-2 text-ui-sm text-muted-foreground">Default branch (loading)</div>
    <EnvironmentSearchSelect
      label="GitHub default (main)"
      searchPlaceholder="Search branches"
      emptyLabel="No branches found"
      disabled
      leading={<GitBranch className="icon-paired shrink-0 text-muted-foreground" />}
      options={[]}
    />
  </div>
);

// The trigger is a PopoverButton with private open state, so the open menu is
// reachable only by driving the real trigger. One click on mount is the honest
// "menu open" render.
export const OpenMenu = () => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState("claude/design-sync-ui-import");
  useEffect(() => {
    const trigger = hostRef.current?.querySelector("button");
    trigger?.click();
  }, []);
  return (
    <div ref={hostRef} className="w-full max-w-md p-4">
      <div className="mb-2 text-ui-sm text-muted-foreground">Base branch</div>
      <EnvironmentSearchSelect
        label={selected}
        searchPlaceholder="Search branches"
        emptyLabel="No branches found"
        menuClassName="w-80"
        leading={<GitBranch className="icon-paired shrink-0 text-muted-foreground" />}
        options={BRANCHES.map((branch) => ({
          id: branch.id,
          label: branch.label,
          detail: branch.detail,
          selected: selected === branch.id,
          onSelect: () => setSelected(branch.id),
        }))}
      />
    </div>
  );
};
