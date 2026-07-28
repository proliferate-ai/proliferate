import { useEffect, useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Archive,
  Copy,
  ExternalLink,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Trash,
} from "@proliferate/ui";

export const ThreadActions = () => (
  <DropdownMenu defaultOpen modal={false}>
    <DropdownMenuTrigger asChild>
      <Button variant="secondary" size="sm">
        <MoreHorizontal className="icon-paired" />
        Thread actions
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuLabel>Design sync — preview authoring</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem>
          <Pencil className="icon-paired" />
          Rename thread
          <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Copy className="icon-paired" />
          Duplicate into new sandbox
        </DropdownMenuItem>
        <DropdownMenuItem>
          <ExternalLink className="icon-paired" />
          Open pull request #482
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem>
        <Archive className="icon-paired" />
        Archive
        <DropdownMenuShortcut>⌘⇧A</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive">
        <Trash className="icon-paired" />
        Delete thread
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

export const CheckboxItems = () => {
  const [running, setRunning] = useState(true);
  const [needsReview, setNeedsReview] = useState(true);
  const [archived, setArchived] = useState(false);
  return (
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">Filter threads</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={running} onCheckedChange={(v) => setRunning(v === true)}>
          Running agents
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={needsReview} onCheckedChange={(v) => setNeedsReview(v === true)}>
          Needs review
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={archived} onCheckedChange={(v) => setArchived(v === true)}>
          Archived
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={false} disabled>
          Shared with my org
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const RadioItems = () => {
  const [model, setModel] = useState("opus-5");
  return (
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">Claude Opus 5</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={model} onValueChange={setModel}>
          <DropdownMenuRadioItem value="opus-5">Claude Opus 5</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="sonnet-4-5">Claude Sonnet 4.5</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="haiku-4-5">Claude Haiku 4.5</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const WithSubmenu = () => {
  // The submenu can only anchor once the parent content has been measured and
  // placed, so it opens on the tick after mount rather than via defaultOpen.
  const [subOpen, setSubOpen] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSubOpen(true), 80);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">
          <GitBranch className="icon-paired" />
          Branch
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem>Create branch from main</DropdownMenuItem>
        <DropdownMenuSub open={subOpen} onOpenChange={setSubOpen}>
          <DropdownMenuSubTrigger>Switch branch</DropdownMenuSubTrigger>
          {/* SubContent must be portalled: DropdownMenuContent is
              overflow-hidden, so an inline sub-panel is clipped away. */}
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuItem>main</DropdownMenuItem>
              <DropdownMenuItem>claude/design-sync-ui-import</DropdownMenuItem>
              <DropdownMenuItem>release/2026.07</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Push (no commits ahead)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
