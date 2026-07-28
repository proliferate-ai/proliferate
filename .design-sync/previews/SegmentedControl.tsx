import { useState } from "react";
import {
  CloudIcon,
  FileCode,
  FileDiff,
  Monitor,
  SegmentedControl,
  SquareTerminal,
} from "@proliferate/ui";

export const SurfaceScope = () => {
  const [surface, setSurface] = useState("cloud");
  return (
    <SegmentedControl
      ariaLabel="Agent authentication surface"
      value={surface}
      onChange={setSurface}
      items={[
        { id: "cloud", label: "Cloud", icon: <CloudIcon /> },
        { id: "local", label: "Local", icon: <Monitor /> },
      ]}
    />
  );
};

export const ViewModes = () => {
  const [view, setView] = useState("diff");
  return (
    <SegmentedControl
      ariaLabel="Review pane"
      value={view}
      onChange={setView}
      items={[
        { id: "diff", label: "Diff", icon: <FileDiff /> },
        { id: "files", label: "Files", icon: <FileCode /> },
        { id: "terminal", label: "Terminal", icon: <SquareTerminal /> },
      ]}
    />
  );
};

export const TextOnly = () => {
  const [filter, setFilter] = useState("active");
  return (
    <SegmentedControl
      ariaLabel="Workspace filter"
      value={filter}
      onChange={setFilter}
      items={[
        { id: "active", label: "Active" },
        { id: "merged", label: "Merged" },
        { id: "archived", label: "Archived" },
      ]}
    />
  );
};

export const WithDisabled = () => {
  const [scope, setScope] = useState("user");
  return (
    <SegmentedControl
      ariaLabel="Settings scope"
      value={scope}
      onChange={setScope}
      items={[
        { id: "user", label: "User" },
        { id: "repo", label: "Repository" },
        { id: "org", label: "Organization", disabled: true },
      ]}
    />
  );
};

export const InAPageHeader = () => {
  const [surface, setSurface] = useState("local");
  return (
    <div className="flex w-full max-w-2xl items-center justify-between gap-4 border-b border-border pb-4">
      <div className="min-w-0">
        <div className="text-ui font-medium text-foreground">Claude Code</div>
        <div className="text-ui-sm text-muted-foreground">
          Credentials and model routing for this harness.
        </div>
      </div>
      <SegmentedControl
        ariaLabel="Agent authentication surface"
        value={surface}
        onChange={setSurface}
        items={[
          { id: "cloud", label: "Cloud", icon: <CloudIcon /> },
          { id: "local", label: "Local", icon: <Monitor /> },
        ]}
      />
    </div>
  );
};
