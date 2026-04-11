import type { CoworkThread } from "@anyharness/sdk";

export function coworkThreadTitle(thread: CoworkThread): string {
  return thread.title?.trim() || "Untitled chat";
}
