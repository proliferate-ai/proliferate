import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@proliferate/ui/primitives/AlertDialog";
import { AnimatedCollapsibleContent } from "@proliferate/ui/primitives/AnimatedCollapsibleContent";
import { AnimatedSwapText } from "@proliferate/ui/primitives/AnimatedSwapText";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Checkbox as CheckboxPrimitive } from "@proliferate/ui/primitives/checkbox-primitive";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@proliferate/ui/primitives/Command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@proliferate/ui/primitives/Dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@proliferate/ui/primitives/DropdownMenu";
import { FixedPositionLayer } from "@proliferate/ui/primitives/FixedPositionLayer";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { PaneIconButton } from "@proliferate/ui/primitives/PaneIconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@proliferate/ui/primitives/Popover";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";
import { RadioCardGroup } from "@proliferate/ui/primitives/RadioCardGroup";
import { RangeSlider } from "@proliferate/ui/primitives/RangeSlider";
import { RowActionIconButton } from "@proliferate/ui/primitives/RowActionIconButton";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import { Select } from "@proliferate/ui/primitives/Select";
import { ShortcutBadge } from "@proliferate/ui/primitives/ShortcutBadge";
import { SkeletonBlock } from "@proliferate/ui/primitives/Skeleton";
import { Spinner } from "@proliferate/ui/primitives/Spinner";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { Tooltip as TooltipPrimitiveRoot, TooltipContent, TooltipProvider, TooltipTrigger } from "@proliferate/ui/primitives/tooltip-primitive";
import { UserAvatar } from "@proliferate/ui/primitives/UserAvatar";
import { Trash } from "@proliferate/ui/icons";
import { useState } from "react";
import { noop } from "#product/components/playground/PlaygroundComposerActions";
import type { LibraryEntry, LibraryTier } from "./types";

function CheckboxDemo() {
  const [checked, setChecked] = useState(true);
  return <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} />;
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

function RangeSliderDemo() {
  return <RangeSlider defaultValue={40} min={0} max={100} onChange={noop} />;
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
    <button type="button" onClick={() => setExpanded((value) => !value)}>
      <AnimatedCollapsibleContent expanded={expanded}>
        <span className="text-ui-sm text-foreground">Collapsible content</span>
      </AnimatedCollapsibleContent>
    </button>
  );
}

function AnimatedSwapTextDemo() {
  const [key, setKey] = useState("a");
  return (
    <button type="button" onClick={() => setKey((current) => (current === "a" ? "b" : "a"))}>
      <AnimatedSwapText valueKey={key} value={key === "a" ? "Value A" : "Value B"} />
    </button>
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

function AlertDialogDemo() {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="secondary" size="sm">Open alert</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete item?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
  { name: "AlertDialog", subpath: "@proliferate/ui/primitives/AlertDialog", render: AlertDialogDemo },
  { name: "AnimatedCollapsibleContent", subpath: "@proliferate/ui/primitives/AnimatedCollapsibleContent", render: AnimatedCollapsibleContentDemo },
  { name: "AnimatedSwapText", subpath: "@proliferate/ui/primitives/AnimatedSwapText", render: AnimatedSwapTextDemo },
  { name: "Badge", subpath: "@proliferate/ui/primitives/Badge", render: () => <Badge tone="info">Badge</Badge> },
  { name: "Button", subpath: "@proliferate/ui/primitives/Button", render: () => <Button size="sm">Button</Button> },
  { name: "Checkbox", subpath: "@proliferate/ui/primitives/Checkbox", render: CheckboxDemo },
  { name: "checkbox-primitive", subpath: "@proliferate/ui/primitives/checkbox-primitive", render: () => <CheckboxPrimitive defaultChecked /> },
  { name: "Command", subpath: "@proliferate/ui/primitives/Command", render: CommandDemo },
  { name: "Dialog", subpath: "@proliferate/ui/primitives/Dialog", render: DialogDemo },
  { name: "DropdownMenu", subpath: "@proliferate/ui/primitives/DropdownMenu", render: DropdownMenuDemo },
  { name: "FixedPositionLayer", subpath: "@proliferate/ui/primitives/FixedPositionLayer", render: () => (
    <div className="relative h-16 w-full">
      <FixedPositionLayer position={{ top: 4, left: 4 }} className="text-ui-sm text-foreground">
        Anchored
      </FixedPositionLayer>
    </div>
  ) },
  { name: "IconButton", subpath: "@proliferate/ui/primitives/IconButton", render: () => (
    <IconButton title="Delete" onClick={noop}><Trash className="icon-paired" /></IconButton>
  ) },
  { name: "Input", subpath: "@proliferate/ui/primitives/Input", render: () => <Input placeholder="Input" defaultValue="" /> },
  { name: "Label", subpath: "@proliferate/ui/primitives/Label", render: () => <Label>Label</Label> },
  { name: "PaneIconButton", subpath: "@proliferate/ui/primitives/PaneIconButton", render: () => (
    <PaneIconButton label="Delete" onClick={noop}><Trash className="icon-paired" /></PaneIconButton>
  ) },
  { name: "Popover", subpath: "@proliferate/ui/primitives/Popover", render: PopoverDemo },
  { name: "PopoverButton", subpath: "@proliferate/ui/primitives/PopoverButton", render: PopoverButtonDemo },
  { name: "PopoverMenuItem", subpath: "@proliferate/ui/primitives/PopoverMenuItem", render: PopoverMenuItemDemo },
  { name: "PopoverSearchField", subpath: "@proliferate/ui/primitives/PopoverSearchField", render: PopoverSearchFieldDemo },
  { name: "ProgressBar", subpath: "@proliferate/ui/primitives/ProgressBar", render: () => (
    <ProgressBar value={60} className="h-2 w-40 overflow-hidden rounded-full bg-input" indicatorClassName="h-full bg-primary" />
  ) },
  { name: "RadioCardGroup", subpath: "@proliferate/ui/primitives/RadioCardGroup", render: RadioCardGroupDemo },
  { name: "RangeSlider", subpath: "@proliferate/ui/primitives/RangeSlider", render: RangeSliderDemo },
  { name: "RowActionIconButton", subpath: "@proliferate/ui/primitives/RowActionIconButton", render: () => (
    <RowActionIconButton label="Delete" visibility="always" onClick={noop}><Trash /></RowActionIconButton>
  ) },
  { name: "SegmentedControl", subpath: "@proliferate/ui/primitives/SegmentedControl", render: SegmentedControlDemo },
  { name: "Select", subpath: "@proliferate/ui/primitives/Select", render: SelectDemo },
  { name: "ShortcutBadge", subpath: "@proliferate/ui/primitives/ShortcutBadge", render: () => <ShortcutBadge label="⌘K" /> },
  { name: "Skeleton", subpath: "@proliferate/ui/primitives/Skeleton", render: () => <SkeletonBlock className="h-4 w-24" /> },
  { name: "Sonner", subpath: "@proliferate/ui/primitives/Sonner", render: () => (
    <Button variant="secondary" size="sm" onClick={noop}>Toast trigger (see app toaster)</Button>
  ) },
  { name: "Spinner", subpath: "@proliferate/ui/primitives/Spinner", render: () => <Spinner className="icon-paired" /> },
  { name: "Switch", subpath: "@proliferate/ui/primitives/Switch", render: SwitchDemo },
  { name: "Textarea", subpath: "@proliferate/ui/primitives/Textarea", render: () => <Textarea placeholder="Textarea" defaultValue="" /> },
  { name: "Tooltip", subpath: "@proliferate/ui/primitives/Tooltip", render: () => (
    <Tooltip content="Tooltip content"><Button variant="secondary" size="sm">Hover me</Button></Tooltip>
  ) },
  { name: "tooltip-primitive", subpath: "@proliferate/ui/primitives/tooltip-primitive", render: TooltipPrimitiveDemo },
  { name: "UserAvatar", subpath: "@proliferate/ui/primitives/UserAvatar", render: () => (
    <UserAvatar displayName="Jane Doe" className="size-8" />
  ) },
];

export const PRIMITIVES_TIER: LibraryTier = {
  id: "primitives",
  title: "Primitives",
  entries: PRIMITIVES_ENTRIES,
};
