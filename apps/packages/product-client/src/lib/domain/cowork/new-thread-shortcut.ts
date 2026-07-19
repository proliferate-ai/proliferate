type CoworkShortcutSurface = "standard" | "cowork";

export function ownsCoworkNewThreadShortcut(
  pathname: string,
  surface: CoworkShortcutSurface,
): boolean {
  return pathname === "/" && surface === "cowork";
}
