import type { CoworkThread } from "@anyharness/sdk";

export const UNTITLED_COWORK_THREAD_TITLE = "Untitled chat";

export function coworkThreadTitle(thread: CoworkThread): string {
  return thread.title?.trim() || UNTITLED_COWORK_THREAD_TITLE;
}
