import type { ComponentType, ReactNode } from "react";
import * as icons from "@proliferate/ui/icons";
import { CommandPaletteGlyph, type CommandPaletteGlyphName } from "@proliferate/ui/icons/command-palette-icons";
import { ProliferateIcon, ProliferateIconSnakeSpiralIn, ProliferateIconSnakeSpiralOut, ProliferateIconSnakeSpokes, ProliferateIconSnakeBounce, RippleLogo } from "@proliferate/ui/icons/proliferate-icons";
import { ProviderIcon } from "@proliferate/ui/icons/provider-icons";
import type { IconProps } from "@proliferate/ui/icons";
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

// Every named glyph export from the general barrel — a general re-export of
// the core/workspace/product/platform/status/app-shell detail modules per
// the component-library spec, so this iterates the barrel object itself
// rather than re-listing each detail module's names.
const ICON_BARREL_ENTRIES = Object.entries(icons).filter(
  ([, value]) => typeof value === "function",
) as Array<[string, ComponentType<IconProps>]>;

// Barrel glyphs whose props go beyond IconProps — fixture values so the
// generic no-props iteration can still render them (PixelAgentSprite hashes
// its required `seed` string to pick sprite pixels).
const ICON_FIXTURE_PROPS: Record<string, Record<string, unknown>> = {
  PixelAgentSprite: { seed: "component-library" },
};

function IconsBarrelDemo() {
  return (
    <GlyphGrid>
      {ICON_BARREL_ENTRIES.map(([name, Icon]) => (
        <GlyphCell key={name} label={name}>
          <Icon {...ICON_FIXTURE_PROPS[name]} />
        </GlyphCell>
      ))}
    </GlyphGrid>
  );
}

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
  { name: "icons", subpath: "@proliferate/ui/icons", render: IconsBarrelDemo },
  { name: "command-palette-icons", subpath: "@proliferate/ui/icons/command-palette-icons", render: CommandPaletteIconsDemo },
  { name: "proliferate-icons", subpath: "@proliferate/ui/icons/proliferate-icons", render: ProliferateIconsDemo },
  { name: "provider-icons", subpath: "@proliferate/ui/icons/provider-icons", render: ProviderIconsDemo },
];

export const ICONS_TIER: LibraryTier = {
  id: "icons",
  title: "Icons",
  entries: ICONS_ENTRIES,
};
