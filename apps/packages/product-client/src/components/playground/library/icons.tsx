import type { ComponentType, ReactNode } from "react";
import * as appShellIcons from "#product/primitives/icons/app-shell";
import * as coreIcons from "#product/primitives/icons/core";
import * as platformIcons from "#product/primitives/icons/platform";
import * as productIcons from "#product/primitives/icons/product";
import * as statusIcons from "#product/primitives/icons/status";
import * as workspaceIcons from "#product/primitives/icons/workspace";
import * as workspaceGitIcons from "#product/primitives/icons/workspace-git";
import { CommandPaletteGlyph, type CommandPaletteGlyphName } from "#product/primitives/icons/command-palette-icons";
import { ProliferateIcon, ProliferateIconSnakeSpiralIn, ProliferateIconSnakeSpiralOut, ProliferateIconSnakeSpokes, ProliferateIconSnakeBounce, RippleLogo } from "#product/primitives/icons/proliferate-icons";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";
import type { IconProps } from "#product/primitives/icons/types";
import type { LibraryEntry, LibraryTier } from "./types";

const COMMAND_PALETTE_GLYPH_NAMES: CommandPaletteGlyphName[] = [
  "arrow-left",
  "arrow-right",
  "chat",
  "chat-plus",
  "cloud-plus",
  "command",
  "folder-plus",
  "git-branch",
  "keyboard",
  "panel-bottom",
  "pencil",
  "play",
  "rotate-ccw",
  "search",
  "settings",
  "terminal",
  "tree",
];

const PROVIDER_ICON_KINDS = ["claude", "codex", "cursor", "grok", "opencode"];

function GlyphCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-border p-2">
      <span className="flex size-6 items-center justify-center text-foreground [&>svg]:icon-large">
        {children}
      </span>
      <span className="max-w-full truncate text-ui-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function GlyphGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{children}</div>;
}

// A few glyphs accept props beyond IconProps. Fixture values let the generic
// module renderer exercise them without weakening their actual contracts.
const ICON_FIXTURE_PROPS: Record<string, Record<string, unknown>> = {
  PixelAgentSprite: { seed: "component-library" },
};

type GlyphEntry = [string, ComponentType<IconProps>];

function glyphEntries(module: Record<string, unknown>): GlyphEntry[] {
  return Object.entries(module)
    .filter((entry): entry is GlyphEntry => typeof entry[1] === "function")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

function IconModuleDemo({ entries }: { entries: GlyphEntry[] }) {
  return (
    <GlyphGrid>
      {entries.map(([name, Icon]) => (
        <GlyphCell key={name} label={name}>
          <Icon {...ICON_FIXTURE_PROPS[name]} />
        </GlyphCell>
      ))}
    </GlyphGrid>
  );
}

const APP_SHELL_ICON_ENTRIES = glyphEntries(appShellIcons);
const CORE_ICON_ENTRIES = glyphEntries(coreIcons);
const PLATFORM_ICON_ENTRIES = glyphEntries(platformIcons);
const PRODUCT_ICON_ENTRIES = glyphEntries(productIcons);
const STATUS_ICON_ENTRIES = glyphEntries(statusIcons);
const WORKSPACE_ICON_ENTRIES = glyphEntries(workspaceIcons);
const WORKSPACE_GIT_ICON_ENTRIES = glyphEntries(workspaceGitIcons);

function CommandPaletteIconsDemo() {
  return (
    <GlyphGrid>
      {COMMAND_PALETTE_GLYPH_NAMES.map((name) => (
        <GlyphCell key={name} label={name}>
          <CommandPaletteGlyph name={name} />
        </GlyphCell>
      ))}
    </GlyphGrid>
  );
}

function ProliferateIconsDemo() {
  return (
    <GlyphGrid>
      <GlyphCell label="ProliferateIcon"><ProliferateIcon /></GlyphCell>
      <GlyphCell label="ProliferateIconSnakeSpiralIn"><ProliferateIconSnakeSpiralIn /></GlyphCell>
      <GlyphCell label="ProliferateIconSnakeSpiralOut"><ProliferateIconSnakeSpiralOut /></GlyphCell>
      <GlyphCell label="ProliferateIconSnakeSpokes"><ProliferateIconSnakeSpokes /></GlyphCell>
      <GlyphCell label="ProliferateIconSnakeBounce"><ProliferateIconSnakeBounce /></GlyphCell>
      <GlyphCell label="RippleLogo"><RippleLogo /></GlyphCell>
    </GlyphGrid>
  );
}

function ProviderIconsDemo() {
  return (
    <GlyphGrid>
      {PROVIDER_ICON_KINDS.map((kind) => (
        <GlyphCell key={kind} label={kind}>
          <ProviderIcon kind={kind} />
        </GlyphCell>
      ))}
    </GlyphGrid>
  );
}

export const ICONS_ENTRIES: LibraryEntry[] = [
  { name: "app-shell", subpath: "#product/primitives/icons/app-shell", render: () => <IconModuleDemo entries={APP_SHELL_ICON_ENTRIES} /> },
  { name: "core", subpath: "#product/primitives/icons/core", render: () => <IconModuleDemo entries={CORE_ICON_ENTRIES} /> },
  { name: "platform", subpath: "#product/primitives/icons/platform", render: () => <IconModuleDemo entries={PLATFORM_ICON_ENTRIES} /> },
  { name: "product", subpath: "#product/primitives/icons/product", render: () => <IconModuleDemo entries={PRODUCT_ICON_ENTRIES} /> },
  { name: "status", subpath: "#product/primitives/icons/status", render: () => <IconModuleDemo entries={STATUS_ICON_ENTRIES} /> },
  { name: "workspace", subpath: "#product/primitives/icons/workspace", render: () => <IconModuleDemo entries={WORKSPACE_ICON_ENTRIES} /> },
  { name: "workspace-git", subpath: "#product/primitives/icons/workspace-git", render: () => <IconModuleDemo entries={WORKSPACE_GIT_ICON_ENTRIES} /> },
  { name: "command-palette-icons", subpath: "#product/primitives/icons/command-palette-icons", render: CommandPaletteIconsDemo },
  { name: "proliferate-icons", subpath: "#product/primitives/icons/proliferate-icons", render: ProliferateIconsDemo },
  { name: "provider-icons", subpath: "#product/primitives/icons/provider-icons", render: ProviderIconsDemo },
];

export const ICONS_TIER: LibraryTier = {
  id: "icons",
  title: "Icons",
  entries: ICONS_ENTRIES,
};
