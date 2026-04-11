export type ArtifactRuntimeType =
  | "text/markdown"
  | "text/html"
  | "image/svg+xml"
  | "application/vnd.proliferate.react";

export interface SetContentPayload {
  artifactId: string;
  type: ArtifactRuntimeType;
  title: string;
  content: string;
}

export type DesktopToRuntimeMessage = {
  method: "SetContent";
  payload: SetContentPayload;
};

export type RuntimeErrorPayload =
  | { type: "UnsupportedImports"; modules: string[] }
  | { type: "LibraryLoadFailed"; modules: string[] }
  | { type: "TransformError"; message: string }
  | { type: "RuntimeError"; message: string };

export type RuntimeToDesktopMessage =
  | { method: "ReadyForContent" }
  | { method: "OpenLink"; payload: { url: string } }
  | { method: "ReportError"; payload: RuntimeErrorPayload };

export function isDesktopToRuntimeMessage(value: unknown): value is DesktopToRuntimeMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (value as { method?: unknown }).method === "SetContent";
}

export function isRuntimeToDesktopMessage(value: unknown): value is RuntimeToDesktopMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const method = (value as { method?: unknown }).method;
  return method === "ReadyForContent"
    || method === "OpenLink"
    || method === "ReportError";
}
