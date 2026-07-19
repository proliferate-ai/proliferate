type CoworkNewThreadShortcutHandler = () => void;

type CoworkShortcutSurface = "standard" | "cowork";

let registeredHandler: {
  token: symbol;
  handler: CoworkNewThreadShortcutHandler;
} | null = null;

export function ownsCoworkNewThreadShortcut(
  pathname: string,
  surface: CoworkShortcutSurface,
): boolean {
  return pathname === "/" && surface === "cowork";
}

/**
 * The authenticated Cowork provider owns the context-sensitive Cmd-N action,
 * while the app shortcut lifecycle owns the one global keyboard registration.
 * This small bridge keeps those owners separate without registering two
 * handlers for the same shortcut id.
 */
export function registerCoworkNewThreadShortcut(
  handler: CoworkNewThreadShortcutHandler,
): () => void {
  const token = Symbol("cowork-new-thread");
  registeredHandler = { token, handler };

  return () => {
    if (registeredHandler?.token === token) {
      registeredHandler = null;
    }
  };
}

export function runCoworkNewThreadShortcut(): boolean {
  if (!registeredHandler) {
    return false;
  }
  registeredHandler.handler();
  return true;
}

export function clearCoworkNewThreadShortcutForTests(): void {
  registeredHandler = null;
}
