import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";
import braveIcon from "@/assets/connector-icons/brave.svg";
import context7Icon from "@/assets/connector-icons/context7.jpeg";
import notionIcon from "@/assets/connector-icons/notion.png";
import openweatherIcon from "@/assets/connector-icons/openweather.svg";
import playwrightIcon from "@/assets/connector-icons/playwright.svg";
import supabaseIcon from "@/assets/connector-icons/supabase.png";
import { Folder, GitHub, Globe, Search, Sun, Terminal } from "@/components/ui/icons";

const CONNECTOR_ICONS = {
  github: GitHub,
  globe: Globe,
  search: Search,
  sun: Sun,
  folder: Folder,
  terminal: Terminal,
} as const;

const CONNECTOR_ICON_IMAGES = {
  brave: braveIcon,
  context7: context7Icon,
  notion: notionIcon,
  openweather: openweatherIcon,
  playwright: playwrightIcon,
  supabase: supabaseIcon,
} as const;

type ConnectorIconSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<ConnectorIconSize, { tile: string; glyph: string }> = {
  sm: { tile: "size-8 rounded-lg p-1", glyph: "size-4" },
  md: { tile: "size-11 rounded-xl p-1.5", glyph: "size-6" },
  lg: { tile: "size-14 rounded-2xl p-2", glyph: "size-8" },
};

export function ConnectorIcon({
  entry,
  size = "md",
}: {
  entry: ConnectorCatalogEntry;
  size?: ConnectorIconSize;
}) {
  const classes = SIZE_CLASSES[size];
  const iconImage = entry.iconId in CONNECTOR_ICON_IMAGES
    ? CONNECTOR_ICON_IMAGES[entry.iconId as keyof typeof CONNECTOR_ICON_IMAGES]
    : null;

  if (iconImage) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center bg-muted/35 ${classes.tile}`}
      >
        <img
          src={iconImage}
          alt=""
          aria-hidden="true"
          className="size-full rounded-[5px] object-contain"
        />
      </div>
    );
  }

  const Icon = CONNECTOR_ICONS[entry.iconId as keyof typeof CONNECTOR_ICONS];
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-muted/35 text-foreground ${classes.tile}`}
    >
      <Icon className={`${classes.glyph} shrink-0`} />
    </div>
  );
}
