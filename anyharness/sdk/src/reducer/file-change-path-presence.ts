import type { FileChangeContentPart } from "../types/events.js";

/** Streaming identity is stable while structured locator metadata is refined. */
export function fileChangeIdentity(part: FileChangeContentPart): string {
  return `${part.path}\u0000${part.newPath ?? ""}`;
}

/** Every supplied string is authoritative, including empty and whitespace. */
export function chooseWorkspacePathString(
  next: string | null | undefined,
  previous: string | null | undefined,
): string | null {
  return typeof next === "string" ? next : previous ?? null;
}
