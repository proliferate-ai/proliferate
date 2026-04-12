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

const TILE_SIZE: Record<ConnectorIconSize, string> = {
  sm: "size-8 rounded-lg",
  md: "size-10 rounded-xl",
  lg: "size-12 rounded-xl",
};

export function ConnectorIcon({
  entry,
  size = "md",
}: {
  entry: ConnectorCatalogEntry;
  size?: ConnectorIconSize;
}) {
  const tileClass = TILE_SIZE[size];
  const iconImage = entry.iconId in CONNECTOR_ICON_IMAGES
    ? CONNECTOR_ICON_IMAGES[entry.iconId as keyof typeof CONNECTOR_ICON_IMAGES]
    : null;

  if (iconImage) {
    return (
      <div className={`flex shrink-0 items-center justify-center overflow-hidden ${tileClass}`}>
        <img
          src={iconImage}
          alt=""
          aria-hidden="true"
          className="size-full object-contain"
        />
      </div>
    );
  }

  const Icon = CONNECTOR_ICONS[entry.iconId as keyof typeof CONNECTOR_ICONS];
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-muted/40 text-foreground ${tileClass}`}
    >
      <Icon className="size-[72%] shrink-0" />
    </div>
  );
}
