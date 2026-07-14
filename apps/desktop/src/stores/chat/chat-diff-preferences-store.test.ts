import { afterEach, describe, expect, it } from "vitest";
import { createMemoryProductStorage } from "@/test/product-storage-test-utils";
import {
  CHAT_DIFF_PREFERENCES_STORAGE_KEY,
  hydrateChatDiffPreferences,
  resetChatDiffPreferencesForTests,
  setChatDiffPreferencesStorageContext,
  useChatDiffPreferencesStore,
} from "./chat-diff-preferences-store";

afterEach(() => {
  resetChatDiffPreferencesForTests();
});

describe("chat diff preferences store", () => {
  it("defaults to false before hydration and persists toggles through the context", async () => {
    const memory = createMemoryProductStorage();
    setChatDiffPreferencesStorageContext(memory.context);

    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(false);

    useChatDiffPreferencesStore.getState().toggleWrapLongLines();
    await Promise.resolve();

    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(true);
    expect(memory.readJson(CHAT_DIFF_PREFERENCES_STORAGE_KEY)).toEqual({ wrapLongLines: true });
  });

  it("hydrates the persisted value into the store", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(CHAT_DIFF_PREFERENCES_STORAGE_KEY, { wrapLongLines: true });
    setChatDiffPreferencesStorageContext(memory.context);

    await hydrateChatDiffPreferences(memory.context);

    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(true);
  });

  it("does not let a late hydration overwrite a user toggle", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(CHAT_DIFF_PREFERENCES_STORAGE_KEY, { wrapLongLines: false });
    setChatDiffPreferencesStorageContext(memory.context);

    useChatDiffPreferencesStore.getState().setWrapLongLines(true);
    await hydrateChatDiffPreferences(memory.context);

    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(true);
  });

  it("ignores a stale hydration read", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(CHAT_DIFF_PREFERENCES_STORAGE_KEY, { wrapLongLines: true });
    setChatDiffPreferencesStorageContext(memory.context);

    await hydrateChatDiffPreferences(memory.context, () => true);

    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(false);
  });
});
