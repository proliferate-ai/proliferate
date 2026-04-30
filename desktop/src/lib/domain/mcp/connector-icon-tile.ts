export interface ConnectorIconImageConfigLike {
  lightSrc?: string;
  darkSrc?: string;
  tileClassName?: string;
  darkTileClassName?: string;
}

export const CONNECTOR_ICON_LIGHT_TILE_CLASS = "bg-brand-logo-tile";
export const CONNECTOR_ICON_DARK_TILE_CLASS = "bg-transparent";

export function selectConnectorIconTileClass(
  config: ConnectorIconImageConfigLike,
  resolvedMode: "dark" | "light",
): string {
  if (resolvedMode === "dark") {
    return config.darkTileClassName ?? CONNECTOR_ICON_DARK_TILE_CLASS;
  }

  return config.tileClassName ?? CONNECTOR_ICON_LIGHT_TILE_CLASS;
}
