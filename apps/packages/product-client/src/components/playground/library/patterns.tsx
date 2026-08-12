import { useState } from "react";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { AuthProviderButton } from "#product/primitives/patterns/AuthProviderButton";
import { CommandPaletteGroup, CommandPaletteInput, CommandPaletteItem, CommandPaletteList, CommandPaletteRoot } from "#product/primitives/patterns/CommandPalette";
import { ComposerActionButton } from "#product/primitives/patterns/composer/ComposerActionButton";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";
import { ComposerTextarea } from "#product/primitives/patterns/composer/ComposerTextarea";
import { ComposerTextareaFrame } from "#product/primitives/patterns/composer/ComposerTextareaFrame";
import { ConfirmationDialog } from "#product/primitives/patterns/ConfirmationDialog";
import { EmptyState } from "#product/primitives/patterns/EmptyState";
import { EnvironmentSearchSelect } from "#product/primitives/patterns/EnvironmentSearchSelect";
import { LevelBarsButton } from "#product/primitives/patterns/composer/LevelBarsButton";
import { ListRow } from "#product/primitives/patterns/ListRow";
import { ModalShell } from "#product/primitives/patterns/ModalShell";
import { PageContentFrame } from "#product/primitives/patterns/PageContentFrame";
import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { PaneOptionsMenuItem } from "#product/primitives/patterns/PaneOptionsMenuItem";
import { PickerPopoverContent } from "#product/primitives/patterns/PickerPopoverContent";
import { SettingsEmptyState } from "#product/primitives/patterns/settings/SettingsEmptyState";
import { SettingsGroup } from "#product/primitives/patterns/settings/SettingsGroup";
import { SettingsMenu } from "#product/primitives/patterns/settings/SettingsMenu";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { SettingsSaveFooter } from "#product/primitives/patterns/settings/SettingsSaveFooter";
import { SettingsScopeTabs } from "#product/primitives/patterns/settings/SettingsScopeTabs";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { SidebarActionButton } from "#product/primitives/patterns/sidebar/SidebarActionButton";
import { SidebarNavRow } from "#product/primitives/patterns/sidebar/SidebarNavRow";
import { SidebarRowSurface } from "#product/primitives/patterns/sidebar/SidebarRowSurface";
import { ThinkingText } from "#product/primitives/patterns/ThinkingText";
import { showToast } from "#product/primitives/utils/show-toast";
import { Button } from "#product/primitives/Button";
import { Switch } from "#product/primitives/Switch";
import { Home } from "#product/primitives/icons/platform";
import { Trash } from "#product/primitives/icons/core";
import { noop } from "#product/components/playground/PlaygroundComposerActions";
// The tabs kit is a pattern subdirectory, so its demos live beside it in their
// own module and spread into this tier's entries.
import { TABS_KIT_ENTRIES } from "./tabs";
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

function SettingsGroupDemo() {
  return (
    <div className="flex w-64 flex-col gap-4">
      <SettingsGroup label="Preferences">
        <div className="flex items-center gap-3.5 px-3.5 py-[13px] text-ui text-foreground">Row one</div>
        <div className="flex items-center gap-3.5 px-3.5 py-[13px] text-ui text-foreground">Row two</div>
        <div className="flex items-center gap-3.5 px-3.5 py-[13px] text-ui text-foreground">Row three</div>
      </SettingsGroup>
      <SettingsGroup empty="No results" />
    </div>
  );
}

function SettingsRowDemo() {
  const [checked, setChecked] = useState(true);
  return (
    <SettingsRow label="Setting label" description="Setting description">
      <Switch checked={checked} onChange={setChecked} />
    </SettingsRow>
  );
}

function SettingsSectionDemo() {
  return (
    <SettingsSection title="Section title" description="Section description">
      <SettingsRow label="Row label" description="Row description">
        <Switch checked onChange={noop} />
      </SettingsRow>
      <SettingsRow label="Another row">
        <Switch checked={false} onChange={noop} />
      </SettingsRow>
    </SettingsSection>
  );
}

function SettingsScopeTabsDemo() {
  const [value, setValue] = useState("user");
  return (
    <SettingsScopeTabs
      items={[{ id: "user", label: "User" }, { id: "org", label: "Org" }]}
      value={value}
      onChange={setValue}
    />
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
          kind: "inline",
          payload: [
            "connect ECONNREFUSED 127.0.0.1:8457",
            "  at TCPConnectWrap.afterConnect",
            "  at Socket.emit",
          ].join("\n"),
        },
        commit: { label: "Retry", onClick: noop },
      })}>
        Error with details
      </Button>
    </div>
  );
}

export const PATTERNS_ENTRIES: LibraryEntry[] = [
  { name: "AuthProviderButton", subpath: "#product/primitives/patterns/AuthProviderButton", render: () => (
    <AuthProviderButton onClick={noop}>Continue with GitHub</AuthProviderButton>
  ) },
  { name: "AutoHideScrollArea", subpath: "#product/primitives/patterns/AutoHideScrollArea", render: AutoHideScrollAreaDemo },
  { name: "CommandPalette", subpath: "#product/primitives/patterns/CommandPalette", render: CommandPaletteDemo },
  { name: "ComposerActionButton", subpath: "#product/primitives/patterns/composer/ComposerActionButton", render: () => (
    <ComposerActionButton onClick={noop}><Home className="icon-paired" /></ComposerActionButton>
  ) },
  { name: "ComposerControlButton", subpath: "#product/primitives/patterns/composer/ComposerControlButton", render: () => (
    <ComposerControlButton label="Auto" icon={<Home className="icon-paired" />} onClick={noop} />
  ) },
  { name: "ComposerTextarea", subpath: "#product/primitives/patterns/composer/ComposerTextarea", render: () => (
    <ComposerTextarea placeholder="Message" defaultValue="" />
  ) },
  { name: "ComposerTextareaFrame", subpath: "#product/primitives/patterns/composer/ComposerTextareaFrame", render: () => (
    <ComposerTextareaFrame topInset="standard">
      <ComposerTextarea placeholder="Message" defaultValue="" />
    </ComposerTextareaFrame>
  ) },
  { name: "ConfirmationDialog", subpath: "#product/primitives/patterns/ConfirmationDialog", render: ConfirmationDialogDemo },
  { name: "EmptyState", subpath: "#product/primitives/patterns/EmptyState", render: () => (
    <EmptyState title="No results" description="Nothing to show yet." />
  ) },
  { name: "EnvironmentSearchSelect", subpath: "#product/primitives/patterns/EnvironmentSearchSelect", render: EnvironmentSearchSelectDemo },
  { name: "LevelBarsButton", subpath: "#product/primitives/patterns/composer/LevelBarsButton", render: LevelBarsButtonDemo },
  { name: "ListRow", subpath: "#product/primitives/patterns/ListRow", render: () => (
    <ListRow title="Row title" description="Row description" onClick={noop} />
  ) },
  { name: "ModalShell", subpath: "#product/primitives/patterns/ModalShell", render: ModalShellDemo },
  { name: "PageContentFrame", subpath: "#product/primitives/patterns/PageContentFrame", render: () => (
    <div className="h-24 overflow-hidden rounded-md border border-border">
      <PageContentFrame header={<div className="text-ui font-medium text-foreground">Header</div>}>
        <p className="text-ui-sm text-muted-foreground">Frame body.</p>
      </PageContentFrame>
    </div>
  ) },
  { name: "PageHeader", subpath: "#product/primitives/patterns/PageHeader", render: () => (
    <PageHeader title="Page title" description="Page description" />
  ) },
  { name: "PaneOptionsMenuItem", subpath: "#product/primitives/patterns/PaneOptionsMenuItem", render: () => (
    <div className="w-48 rounded-lg border border-border p-1">
      <PaneOptionsMenuItem label="Menu item" icon={<Trash />} onClick={noop} />
    </div>
  ) },
  { name: "PickerPopoverContent", subpath: "#product/primitives/patterns/PickerPopoverContent", render: PickerPopoverContentDemo },
  { name: "SettingsEmptyState", subpath: "#product/primitives/patterns/settings/SettingsEmptyState", render: () => (
    <SettingsEmptyState title="No results" description="Nothing to show yet." size="compact" />
  ) },
  { name: "SettingsGroup", subpath: "#product/primitives/patterns/settings/SettingsGroup", render: SettingsGroupDemo },
  { name: "SettingsMenu", subpath: "#product/primitives/patterns/settings/SettingsMenu", render: SettingsMenuDemo },
  { name: "SettingsRow", subpath: "#product/primitives/patterns/settings/SettingsRow", render: SettingsRowDemo },
  { name: "SettingsSaveFooter", subpath: "#product/primitives/patterns/settings/SettingsSaveFooter", render: () => (
    <SettingsSaveFooter onSave={noop} onRevert={noop} />
  ) },
  { name: "SettingsScopeTabs", subpath: "#product/primitives/patterns/settings/SettingsScopeTabs", render: SettingsScopeTabsDemo },
  { name: "SettingsSection", subpath: "#product/primitives/patterns/settings/SettingsSection", render: SettingsSectionDemo },
  { name: "SidebarActionButton", subpath: "#product/primitives/patterns/sidebar/SidebarActionButton", render: SidebarActionButtonDemo },
  { name: "SidebarNavRow", subpath: "#product/primitives/patterns/sidebar/SidebarNavRow", render: SidebarNavRowDemo },
  { name: "SidebarRowSurface", subpath: "#product/primitives/patterns/sidebar/SidebarRowSurface", render: SidebarRowSurfaceDemo },
  ...TABS_KIT_ENTRIES,
  { name: "ThinkingText", subpath: "#product/primitives/patterns/ThinkingText", render: () => <ThinkingText /> },
  { name: "ToastHost", subpath: "#product/primitives/patterns/toast/ToastHost", render: ToastHostDemo },
];

export const PATTERNS_TIER: LibraryTier = {
  id: "patterns",
  title: "Patterns",
  entries: PATTERNS_ENTRIES,
};
