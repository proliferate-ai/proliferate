import { AnchoredCommandPopover } from "#product/primitives/AnchoredCommandPopover";
import { AnimatedCollapsibleContent } from "#product/primitives/AnimatedCollapsibleContent";
import { AnimatedSwapText } from "#product/primitives/AnimatedSwapText";
import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { Checkbox } from "#product/primitives/Checkbox";
import { Checkbox as CheckboxPrimitive } from "#product/primitives/checkbox-primitive";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "#product/primitives/Command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "#product/primitives/Dialog";
import { DotCellLoader } from "#product/primitives/DotCellLoader";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "#product/primitives/DropdownMenu";
import { FixedPositionLayer } from "#product/primitives/FixedPositionLayer";
import { IconButton } from "#product/primitives/IconButton";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { LoadingBoundary, type LoadingBoundaryState } from "#product/primitives/LoadingBoundary";
import { PaneIconButton } from "#product/primitives/PaneIconButton";
import { Popover, PopoverContent, PopoverTrigger } from "#product/primitives/Popover";
import { PopoverButton } from "#product/primitives/PopoverButton";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { PopoverSearchField } from "#product/primitives/PopoverSearchField";
import { ProgressBar } from "#product/primitives/ProgressBar";
import { RadioCardGroup } from "#product/primitives/RadioCardGroup";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { SegmentedControl } from "#product/primitives/SegmentedControl";
import { Select } from "#product/primitives/Select";
import { ShortcutBadge } from "#product/primitives/ShortcutBadge";
import { SkeletonBlock } from "#product/primitives/Skeleton";
import { Spinner } from "#product/primitives/Spinner";
import { Switch } from "#product/primitives/Switch";
import { Textarea } from "#product/primitives/Textarea";
import { Tooltip } from "#product/primitives/Tooltip";
import { Tooltip as TooltipPrimitiveRoot, TooltipContent, TooltipProvider, TooltipTrigger } from "#product/primitives/tooltip-primitive";
import { TypewriterRevealText } from "#product/primitives/TypewriterRevealText";
import { UserAvatar } from "#product/primitives/UserAvatar";
import { Trash } from "#product/primitives/icons/core";
import { useState } from "react";
import { noop } from "#product/components/playground/PlaygroundComposerActions";
// Demos with more than a one-liner's worth of fixture live beside the tier in
// `entries/` so several authors can add vocabulary without editing this file.
import { ICON_TILE_LIBRARY_ENTRY } from "./entries/icon-tile";
import { STATUS_DOT_ENTRY } from "./entries/status-dot";
import type { LibraryEntry, LibraryTier } from "./types";

function CheckboxDemo() {
  const [checked, setChecked] = useState(true);
  return <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} />;
}

function TypewriterRevealTextDemo() {
  // Starts unassigned so clicking replays the one-time first-assignment reveal.
  const [name, setName] = useState<string | null>(null);
  return (
    <Button variant="secondary" size="sm" onClick={() => setName(name ? null : "Named session")}>
      <TypewriterRevealText text={name ?? "Untitled"} revealOnFirstAssignment={name !== null} />
    </Button>
  );
}

function LoadingBoundaryDemo() {
  // The shared loading gate: `pending | empty | ready`. Clicking re-enters
  // `pending`, so the 200ms show-delay suppresses a fast resolve and the 300ms
  // min-display floor holds a treatment that did mount, before the one
  // sanctioned content fade-in reveals the resolved content.
  const [state, setState] = useState<LoadingBoundaryState>("ready");
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        setState("pending");
        window.setTimeout(() => setState("ready"), 600);
      }}
    >
      <LoadingBoundary
        state={state}
        diagnostics={{ flow: "library.loading-boundary" }}
        treatment={<Spinner className="icon-paired" />}
      >
        <span className="text-ui-sm text-foreground">Resolved content</span>
      </LoadingBoundary>
    </Button>
  );
}

function SwitchDemo() {
  const [checked, setChecked] = useState(true);
  return <Switch checked={checked} onChange={setChecked} />;
}

function SelectDemo() {
  return (
    <Select defaultValue="b" onChange={noop}>
      <option value="a">Option A</option>
      <option value="b">Option B</option>
    </Select>
  );
}

function RadioCardGroupDemo() {
  const [value, setValue] = useState<"a" | "b">("a");
  return (
    <RadioCardGroup
      value={value}
      onChange={setValue}
      options={[
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
      ]}
    />
  );
}

function SegmentedControlDemo() {
  const [value, setValue] = useState<"one" | "two">("one");
  return (
    <SegmentedControl
      ariaLabel="Demo"
      value={value}
      onChange={setValue}
      items={[
        { id: "one", label: "One" },
        { id: "two", label: "Two" },
      ]}
    />
  );
}

function AnimatedCollapsibleContentDemo() {
  const [expanded, setExpanded] = useState(true);
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
      <AnimatedCollapsibleContent expanded={expanded}>
        <span className="text-ui-sm text-foreground">Collapsible content</span>
      </AnimatedCollapsibleContent>
    </Button>
  );
}

function AnimatedSwapTextDemo() {
  const [key, setKey] = useState("a");
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => setKey((current) => (current === "a" ? "b" : "a"))}>
      <AnimatedSwapText valueKey={key} value={key === "a" ? "Value A" : "Value B"} />
    </Button>
  );
}

function DialogDemo() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sample dialog</DialogTitle>
          <DialogDescription>Spec-sheet trigger — closes on demand.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm">Cancel</Button>
          <Button size="sm">Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function PopoverDemo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <span className="text-ui-sm text-foreground">Popover content</span>
      </PopoverContent>
    </Popover>
  );
}

function AnchoredCommandPopoverDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Raise command surface
      </Button>
      <AnchoredCommandPopover
        open={open}
        onOpenChange={setOpen}
        aria-label="Command surface"
      >
        <div className="p-1">
          <PopoverMenuItem label="Menu item" onClick={() => setOpen(false)} />
        </div>
      </AnchoredCommandPopover>
    </>
  );
}

function PopoverButtonDemo() {
  return (
    <PopoverButton trigger={<Button variant="secondary" size="sm">Open menu</Button>}>
      {(close) => (
        <PopoverMenuItem label="Menu item" onClick={close} />
      )}
    </PopoverButton>
  );
}

function PopoverMenuItemDemo() {
  return (
    <div className="w-48 rounded-lg border border-border p-1">
      <PopoverMenuItem label="Menu item" onClick={noop} />
    </div>
  );
}

function PopoverSearchFieldDemo() {
  const [value, setValue] = useState("");
  return (
    <div className="w-56 rounded-lg border border-border">
      <PopoverSearchField value={value} onChange={setValue} placeholder="Search" />
    </div>
  );
}

function DropdownMenuDemo() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">Open dropdown</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Menu item</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandDemo() {
  return (
    <Command className="w-56 rounded-lg border border-border">
      <CommandInput placeholder="Search" />
      <CommandList>
        <CommandEmpty>No results</CommandEmpty>
        <CommandGroup>
          <CommandItem>Item one</CommandItem>
          <CommandItem>Item two</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function TooltipPrimitiveDemo() {
  return (
    <TooltipProvider>
      <TooltipPrimitiveRoot>
        <TooltipTrigger asChild>
          <Button variant="secondary" size="sm">Hover me</Button>
        </TooltipTrigger>
        <TooltipContent>Raw tooltip content</TooltipContent>
      </TooltipPrimitiveRoot>
    </TooltipProvider>
  );
}

export const PRIMITIVES_ENTRIES: LibraryEntry[] = [
  { name: "AnchoredCommandPopover", subpath: "#product/primitives/AnchoredCommandPopover", render: AnchoredCommandPopoverDemo },
  { name: "AnimatedCollapsibleContent", subpath: "#product/primitives/AnimatedCollapsibleContent", render: AnimatedCollapsibleContentDemo },
  { name: "AnimatedSwapText", subpath: "#product/primitives/AnimatedSwapText", render: AnimatedSwapTextDemo },
  { name: "Badge", subpath: "#product/primitives/Badge", render: () => (
    <span className="flex items-center gap-2">
      <Badge tone="info">Badge</Badge>
      <Badge size="micro">12</Badge>
      <Badge size="micro" tone="warning">emulated</Badge>
    </span>
  ) },
  { name: "Button", subpath: "#product/primitives/Button", render: () => <Button size="sm">Button</Button> },
  { name: "Checkbox", subpath: "#product/primitives/Checkbox", render: CheckboxDemo },
  { name: "checkbox-primitive", subpath: "#product/primitives/checkbox-primitive", render: () => <CheckboxPrimitive defaultChecked /> },
  { name: "Command", subpath: "#product/primitives/Command", render: CommandDemo },
  { name: "Dialog", subpath: "#product/primitives/Dialog", render: DialogDemo },
  { name: "DotCellLoader", subpath: "#product/primitives/DotCellLoader", render: () => (
    <span className="flex items-center gap-3 text-foreground">
      <DotCellLoader variant="wave" />
      <DotCellLoader variant="orbit" />
      <DotCellLoader variant="scan" />
      <DotCellLoader variant="helix" />
      <DotCellLoader variant="breathe" />
    </span>
  ) },
  { name: "DropdownMenu", subpath: "#product/primitives/DropdownMenu", render: DropdownMenuDemo },
  { name: "FixedPositionLayer", subpath: "#product/primitives/FixedPositionLayer", render: () => (
    <div className="relative h-16 w-full">
      <FixedPositionLayer position={{ top: 4, left: 4 }} className="text-ui-sm text-foreground">
        Anchored
      </FixedPositionLayer>
    </div>
  ) },
  { name: "IconButton", subpath: "#product/primitives/IconButton", render: () => (
    <IconButton title="Delete" onClick={noop}><Trash className="icon-paired" /></IconButton>
  ) },
  ICON_TILE_LIBRARY_ENTRY,
  { name: "Input", subpath: "#product/primitives/Input", render: () => <Input placeholder="Input" defaultValue="" /> },
  { name: "Label", subpath: "#product/primitives/Label", render: () => <Label>Label</Label> },
  { name: "LoadingBoundary", subpath: "#product/primitives/LoadingBoundary", render: LoadingBoundaryDemo },
  { name: "PaneIconButton", subpath: "#product/primitives/PaneIconButton", render: () => (
    <PaneIconButton label="Delete" onClick={noop}><Trash className="icon-paired" /></PaneIconButton>
  ) },
  { name: "Popover", subpath: "#product/primitives/Popover", render: PopoverDemo },
  { name: "PopoverButton", subpath: "#product/primitives/PopoverButton", render: PopoverButtonDemo },
  { name: "PopoverMenuItem", subpath: "#product/primitives/PopoverMenuItem", render: PopoverMenuItemDemo },
  { name: "PopoverSearchField", subpath: "#product/primitives/PopoverSearchField", render: PopoverSearchFieldDemo },
  { name: "ProgressBar", subpath: "#product/primitives/ProgressBar", render: () => (
    <ProgressBar value={60} className="h-2 w-40 overflow-hidden rounded-full bg-input" indicatorClassName="h-full bg-primary" />
  ) },
  { name: "RadioCardGroup", subpath: "#product/primitives/RadioCardGroup", render: RadioCardGroupDemo },
  { name: "RowActionIconButton", subpath: "#product/primitives/RowActionIconButton", render: () => (
    <RowActionIconButton label="Delete" visibility="always" onClick={noop}><Trash /></RowActionIconButton>
  ) },
  { name: "SegmentedControl", subpath: "#product/primitives/SegmentedControl", render: SegmentedControlDemo },
  { name: "Select", subpath: "#product/primitives/Select", render: SelectDemo },
  { name: "ShortcutBadge", subpath: "#product/primitives/ShortcutBadge", render: () => <ShortcutBadge label="⌘K" /> },
  { name: "Skeleton", subpath: "#product/primitives/Skeleton", render: () => <SkeletonBlock className="h-4 w-24" /> },
  { name: "Sonner", subpath: "#product/primitives/Sonner", render: () => (
    <Button variant="secondary" size="sm" onClick={noop}>Toast trigger (see app toaster)</Button>
  ) },
  { name: "Spinner", subpath: "#product/primitives/Spinner", render: () => <Spinner className="icon-paired" /> },
  STATUS_DOT_ENTRY,
  { name: "Switch", subpath: "#product/primitives/Switch", render: SwitchDemo },
  { name: "Textarea", subpath: "#product/primitives/Textarea", render: () => <Textarea placeholder="Textarea" defaultValue="" /> },
  { name: "Tooltip", subpath: "#product/primitives/Tooltip", render: () => (
    <Tooltip content="Tooltip content"><Button variant="secondary" size="sm">Hover me</Button></Tooltip>
  ) },
  { name: "tooltip-primitive", subpath: "#product/primitives/tooltip-primitive", render: TooltipPrimitiveDemo },
  { name: "TypewriterRevealText", subpath: "#product/primitives/TypewriterRevealText", render: TypewriterRevealTextDemo },
  { name: "UserAvatar", subpath: "#product/primitives/UserAvatar", render: () => (
    <UserAvatar displayName="Jane Doe" className="size-8" />
  ) },
];

export const PRIMITIVES_TIER: LibraryTier = {
  id: "primitives",
  title: "Primitives",
  entries: PRIMITIVES_ENTRIES,
};
