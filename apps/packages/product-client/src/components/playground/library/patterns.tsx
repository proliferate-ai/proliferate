import { useState } from "react";
import { AutoHideScrollArea } from "@proliferate/ui/patterns/AutoHideScrollArea";
import { AuthProviderButton } from "@proliferate/ui/patterns/AuthProviderButton";
import { CommandPaletteGroup, CommandPaletteInput, CommandPaletteItem, CommandPaletteList, CommandPaletteRoot } from "@proliferate/ui/patterns/CommandPalette";
import { ComposerActionButton } from "@proliferate/ui/patterns/ComposerActionButton";
import { ComposerControlButton } from "@proliferate/ui/patterns/ComposerControlButton";
import { ComposerTextarea } from "@proliferate/ui/patterns/ComposerTextarea";
import { ComposerTextareaFrame } from "@proliferate/ui/patterns/ComposerTextareaFrame";
import { ConfirmationDialog } from "@proliferate/ui/patterns/ConfirmationDialog";
import { EmptyState } from "@proliferate/ui/patterns/EmptyState";
import { EnvironmentSearchSelect } from "@proliferate/ui/patterns/EnvironmentSearchSelect";
import { LevelBarsButton } from "@proliferate/ui/patterns/LevelBarsButton";
import { ListRow } from "@proliferate/ui/patterns/ListRow";
import { ModalShell } from "@proliferate/ui/patterns/ModalShell";
import { PageContentFrame } from "@proliferate/ui/patterns/PageContentFrame";
import { PageHeader } from "@proliferate/ui/patterns/PageHeader";
import { PaneOptionsMenuItem } from "@proliferate/ui/patterns/PaneOptionsMenuItem";
import { PickerPopoverContent } from "@proliferate/ui/patterns/PickerPopoverContent";
import { SettingsMenu } from "@proliferate/ui/patterns/SettingsMenu";
import { SidebarActionButton } from "@proliferate/ui/patterns/SidebarActionButton";
import { SidebarNavRow } from "@proliferate/ui/patterns/SidebarNavRow";
import { SidebarRowSurface } from "@proliferate/ui/patterns/SidebarRowSurface";
import { ThinkingText } from "@proliferate/ui/patterns/ThinkingText";
import { showToast } from "@proliferate/ui/utils/show-toast";
import { Button } from "@proliferate/ui/primitives/Button";
import { Home, Trash } from "@proliferate/ui/icons";
import { noop } from "#product/components/playground/PlaygroundComposerActions";
import type { LibraryEntry, LibraryTier } from "./types";

function CommandPaletteDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Open palette</Button>
      <CommandPaletteRoot open={open} onClose={() => setOpen(false)} label="Demo palette">
        <CommandPaletteInput placeholder="Search" />
        <CommandPaletteList>
          <CommandPaletteGroup heading="Actions">
            <CommandPaletteItem>Item one</CommandPaletteItem>
            <CommandPaletteItem>Item two</CommandPaletteItem>
          </CommandPaletteGroup>
        </CommandPaletteList>
      </CommandPaletteRoot>
    </>
  );
}

function ConfirmationDialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Open confirm</Button>
      <ConfirmationDialog
        open={open}
        title="Delete workspace?"
        description="This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onClose={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}

function ModalShellDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Open modal</Button>
      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        title="Sample modal"
        description="A spec-sheet trigger for the modal shell."
      >
        <p className="text-ui-sm text-muted-foreground">Modal body content.</p>
      </ModalShell>
    </>
  );
}

function EnvironmentSearchSelectDemo() {
  const [selected, setSelected] = useState("prod");
  return (
    <EnvironmentSearchSelect
      label={selected}
      searchPlaceholder="Search environments"
      emptyLabel="No environments"
      options={[
        { id: "prod", label: "prod", selected: selected === "prod", onSelect: () => setSelected("prod") },
        { id: "staging", label: "staging", selected: selected === "staging", onSelect: () => setSelected("staging") },
      ]}
    />
  );
}

function SettingsMenuDemo() {
  const [selected, setSelected] = useState("a");
  return (
    <SettingsMenu
      label={selected === "a" ? "Option A" : "Option B"}
      groups={[{
        id: "group",
        options: [
          { id: "a", label: "Option A", selected: selected === "a", onSelect: () => setSelected("a") },
          { id: "b", label: "Option B", selected: selected === "b", onSelect: () => setSelected("b") },
        ],
      }]}
    />
  );
}

function LevelBarsButtonDemo() {
  const [index, setIndex] = useState(1);
  const levels = [
    { value: "low", label: "Low" },
    { value: "mid", label: "Mid" },
    { value: "high", label: "High" },
  ];
  return (
    <LevelBarsButton
      levels={levels}
      currentIndex={index}
      onStep={(value) => setIndex(levels.findIndex((level) => level.value === value))}
    />
  );
}

function SidebarNavRowDemo() {
  return (
    <div className="w-48 bg-sidebar-background p-1">
      <SidebarNavRow icon={<Home className="icon-paired" />} label="Home" active onPress={noop} />
    </div>
  );
}

function SidebarRowSurfaceDemo() {
  return (
    <div className="w-48 bg-sidebar-background p-1">
      <SidebarRowSurface as="button" onPress={noop} className="h-8 px-2">
        <span className="text-sidebar-nav">Row surface</span>
      </SidebarRowSurface>
    </div>
  );
}

function SidebarActionButtonDemo() {
  return (
    <div className="bg-sidebar-background p-1">
      <SidebarActionButton title="Delete" alwaysVisible onClick={noop}>
        <Trash />
      </SidebarActionButton>
    </div>
  );
}

function AutoHideScrollAreaDemo() {
  return (
    <AutoHideScrollArea className="h-16 w-40 rounded-md border border-border">
      <div className="space-y-1 p-2">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="text-ui-sm text-foreground">Row {index + 1}</div>
        ))}
      </div>
    </AutoHideScrollArea>
  );
}

function PickerPopoverContentDemo() {
  const [value, setValue] = useState("");
  return (
    <div className="w-56 rounded-lg border border-border">
      <PickerPopoverContent
        searchValue={value}
        onSearchChange={setValue}
        emptyLabel="No results"
      >
        <div className="px-2 py-1 text-ui-sm text-foreground">Row</div>
      </PickerPopoverContent>
    </div>
  );
}

/**
 * The host itself is already mounted once at the app root, so the sheet demos
 * it the only way it is ever used: by raising one of each weight through
 * `showToast` and letting the real mount render them.
 */
function ToastHostDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={() => showToast({ message: "Workspace archived", tone: "success" })}>
        Status
      </Button>
      <Button variant="secondary" size="sm" onClick={() => showToast({
        weight: "announcement",
        badge: "UPDATE",
        tone: "success",
        title: "Proliferate 0.4.1 is ready",
        description: "Restart takes about 5 seconds and reopens where you left off.",
        secondary: { label: "Later", onClick: noop },
        commit: { label: "Restart", onClick: noop },
      })}>
        Announcement
      </Button>
      <Button variant="secondary" size="sm" onClick={() => showToast({
        weight: "detail",
        tone: "warning",
        title: "3 files could not be staged",
        description: "The commit was not created. Nothing was written.",
        payload: ["src/page.tsx", "src/layout.tsx", "src/route.ts"].join("\n"),
        jump: { label: "Open changes", onClick: noop },
      })}>
        Detail
      </Button>
      <Button variant="secondary" size="sm" onClick={() => showToast({
        weight: "announcement",
        tone: "destructive",
        isError: true,
        title: "Could not reach the runtime",
        description: "The session is still open. Nothing was lost.",
        details: {
          kind: "modal",
          title: "Runtime unreachable",
          subtitle: "workspace · proliferate",
          payload: [
            "connect ECONNREFUSED 127.0.0.1:8457",
            "  at TCPConnectWrap.afterConnect",
            "  at Socket.emit",
          ].join("\n"),
        },
      })}>
        Details modal
      </Button>
    </div>
  );
}

export const PATTERNS_ENTRIES: LibraryEntry[] = [
  { name: "AuthProviderButton", subpath: "@proliferate/ui/patterns/AuthProviderButton", render: () => (
    <AuthProviderButton onClick={noop}>Continue with GitHub</AuthProviderButton>
  ) },
  { name: "AutoHideScrollArea", subpath: "@proliferate/ui/patterns/AutoHideScrollArea", render: AutoHideScrollAreaDemo },
  { name: "CommandPalette", subpath: "@proliferate/ui/patterns/CommandPalette", render: CommandPaletteDemo },
  { name: "ComposerActionButton", subpath: "@proliferate/ui/patterns/ComposerActionButton", render: () => (
    <ComposerActionButton onClick={noop}><Home className="icon-paired" /></ComposerActionButton>
  ) },
  { name: "ComposerControlButton", subpath: "@proliferate/ui/patterns/ComposerControlButton", render: () => (
    <ComposerControlButton label="Auto" icon={<Home className="icon-paired" />} onClick={noop} />
  ) },
  { name: "ComposerTextarea", subpath: "@proliferate/ui/patterns/ComposerTextarea", render: () => (
    <ComposerTextarea placeholder="Message" defaultValue="" />
  ) },
  { name: "ComposerTextareaFrame", subpath: "@proliferate/ui/patterns/ComposerTextareaFrame", render: () => (
    <ComposerTextareaFrame topInset="standard">
      <ComposerTextarea placeholder="Message" defaultValue="" />
    </ComposerTextareaFrame>
  ) },
  { name: "ConfirmationDialog", subpath: "@proliferate/ui/patterns/ConfirmationDialog", render: ConfirmationDialogDemo },
  { name: "EmptyState", subpath: "@proliferate/ui/patterns/EmptyState", render: () => (
    <EmptyState title="No results" description="Nothing to show yet." />
  ) },
  { name: "EnvironmentSearchSelect", subpath: "@proliferate/ui/patterns/EnvironmentSearchSelect", render: EnvironmentSearchSelectDemo },
  { name: "LevelBarsButton", subpath: "@proliferate/ui/patterns/LevelBarsButton", render: LevelBarsButtonDemo },
  { name: "ListRow", subpath: "@proliferate/ui/patterns/ListRow", render: () => (
    <ListRow title="Row title" description="Row description" onClick={noop} />
  ) },
  { name: "ModalShell", subpath: "@proliferate/ui/patterns/ModalShell", render: ModalShellDemo },
  { name: "PageContentFrame", subpath: "@proliferate/ui/patterns/PageContentFrame", render: () => (
    <div className="h-24 overflow-hidden rounded-md border border-border">
      <PageContentFrame header={<div className="text-ui font-medium text-foreground">Header</div>}>
        <p className="text-ui-sm text-muted-foreground">Frame body.</p>
      </PageContentFrame>
    </div>
  ) },
  { name: "PageHeader", subpath: "@proliferate/ui/patterns/PageHeader", render: () => (
    <PageHeader title="Page title" description="Page description" />
  ) },
  { name: "PaneOptionsMenuItem", subpath: "@proliferate/ui/patterns/PaneOptionsMenuItem", render: () => (
    <div className="w-48 rounded-lg border border-border p-1">
      <PaneOptionsMenuItem label="Menu item" icon={<Trash />} onClick={noop} />
    </div>
  ) },
  { name: "PickerPopoverContent", subpath: "@proliferate/ui/patterns/PickerPopoverContent", render: PickerPopoverContentDemo },
  { name: "SettingsMenu", subpath: "@proliferate/ui/patterns/SettingsMenu", render: SettingsMenuDemo },
  { name: "SidebarActionButton", subpath: "@proliferate/ui/patterns/SidebarActionButton", render: SidebarActionButtonDemo },
  { name: "SidebarNavRow", subpath: "@proliferate/ui/patterns/SidebarNavRow", render: SidebarNavRowDemo },
  { name: "SidebarRowSurface", subpath: "@proliferate/ui/patterns/SidebarRowSurface", render: SidebarRowSurfaceDemo },
  { name: "ThinkingText", subpath: "@proliferate/ui/patterns/ThinkingText", render: () => <ThinkingText /> },
  { name: "ToastHost", subpath: "@proliferate/ui/patterns/ToastHost", render: ToastHostDemo },
];

export const PATTERNS_TIER: LibraryTier = {
  id: "patterns",
  title: "Patterns",
  entries: PATTERNS_ENTRIES,
};
