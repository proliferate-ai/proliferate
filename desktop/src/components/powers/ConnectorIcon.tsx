import type { SVGProps } from "react";
import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";
import context7Icon from "@/assets/connector-icons/context7.jpeg";
import filesystemIcon from "@/assets/connector-icons/filesystem.svg";
import notionIcon from "@/assets/connector-icons/notion.png";
import playwrightIcon from "@/assets/connector-icons/playwright.svg";
import supabaseIcon from "@/assets/connector-icons/supabase.png";
import {
  Calendar,
  Folder,
  GitHub,
  Globe,
  Search,
  Sun,
  Terminal,
} from "@/components/ui/icons";

function LinearGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 100 100"
      className={className}
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z"
      />
    </svg>
  );
}

function TavilyGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 56 56"
      className={className}
      {...props}
    >
      <path d="M39.5137 0C45.2842 0 48.17 0 50.374 1.12305C52.3127 2.11089 53.8892 3.68731 54.877 5.62598C55.9998 7.82995 56 10.7153 56 16.4854V39.5146C56 45.2847 55.9998 48.17 54.877 50.374C53.8891 52.3127 52.3127 53.8891 50.374 54.877C48.17 56 45.2842 56 39.5137 56H16.4854C10.7148 56 7.82905 56 5.625 54.877C3.68646 53.8891 2.11082 52.3126 1.12305 50.374C0 48.17 0 45.2849 0 39.5146V16.4854C0 10.7151 0 7.82999 1.12305 5.62598C2.11082 3.68739 3.68646 2.11089 5.625 1.12305C7.82905 0 10.7148 0 16.4854 0H39.5137ZM23.8105 30.958C23.5077 30.9581 23.2076 31.0175 22.9277 31.1338C22.6478 31.2502 22.393 31.4216 22.1787 31.6367L17.7705 36.0625L16.5986 34.8867C15.7377 34.0228 14.2649 34.4498 13.9971 35.6426L12.3271 43.0713C12.2686 43.3267 12.2752 43.593 12.3477 43.8447C12.4199 44.0956 12.555 44.3246 12.7393 44.5088L12.7383 44.5107C12.922 44.6967 13.1498 44.8324 13.4004 44.9053C13.6513 44.9782 13.9173 44.9856 14.1719 44.9268L21.5713 43.25C22.7588 42.9812 23.1851 41.502 22.3242 40.6377L21.1523 39.4619L25.5615 35.0371C25.9943 34.6025 26.2373 34.012 26.2373 33.3975C26.2372 32.783 25.9942 32.1934 25.5615 31.7588L25.5029 31.6992L25.5049 31.6982L25.4434 31.6367C25.229 31.4215 24.9744 31.2503 24.6943 31.1338C24.4144 31.0174 24.1136 30.958 23.8105 30.958ZM39.7139 28.1689C38.6842 27.5158 37.3429 28.2597 37.3428 29.4824V31.1445H27.8955C28.2111 31.7502 28.3916 32.439 28.3916 33.1699C28.3915 34.2266 28.0177 35.196 27.3965 35.9521H37.3418V37.6143C37.342 38.837 38.6843 39.58 39.7139 38.9268L46.1279 34.8613C46.6077 34.5556 46.8476 34.0509 46.8477 33.5469C46.847 33.0436 46.6067 32.5399 46.126 32.2354L39.7139 28.1689ZM24.0391 10.4062C23.778 10.4051 23.5207 10.4712 23.292 10.5977C23.063 10.7243 22.869 10.9083 22.7305 11.1309L18.6807 17.5684H18.6787C18.028 18.602 18.7694 19.9499 19.9873 19.9502H21.6436V29.5137C22.3307 29.0592 23.1537 28.794 24.0381 28.7939C24.9228 28.794 25.7453 29.0599 26.4326 29.5146V19.9502H28.0898C29.3077 19.9501 30.047 18.6028 29.3975 17.5684L25.3457 11.1309C25.0415 10.6489 24.5406 10.4068 24.0391 10.4062Z" />
    </svg>
  );
}

const CONNECTOR_ICONS = {
  calendar: Calendar,
  github: GitHub,
  globe: Globe,
  linear: LinearGlyph,
  search: Search,
  sun: Sun,
  tavily: TavilyGlyph,
  folder: Folder,
  terminal: Terminal,
} as const;

const CONNECTOR_ICON_IMAGES = {
  context7: context7Icon,
  filesystem: filesystemIcon,
  notion: notionIcon,
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
    // Brand logos are rendered as raster/SVG assets with their own colors,
    // so we give them a theme-stable light tile so dark/transparent marks
    // stay legible in dark mode.
    return (
      <div className={`flex shrink-0 items-center justify-center overflow-hidden bg-white ${tileClass}`}>
        <img
          src={iconImage}
          alt=""
          aria-hidden="true"
          className="size-full object-contain"
        />
      </div>
    );
  }

  const Icon = CONNECTOR_ICONS[entry.iconId as keyof typeof CONNECTOR_ICONS] ?? Globe;
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-muted/40 text-foreground ${tileClass}`}
    >
      <Icon className="size-[72%] shrink-0" />
    </div>
  );
}
