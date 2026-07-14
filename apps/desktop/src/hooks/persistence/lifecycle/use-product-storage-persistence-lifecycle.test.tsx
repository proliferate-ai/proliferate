// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryProductStorage,
  type MemoryProductStorage,
} from "@/test/product-storage-test-utils";
import {
  makeTestProductHost,
  productHostWrapper,
} from "@/test/product-host-test-utils";
import {
  resetChatDiffPreferencesForTests,
  useChatDiffPreferencesStore,
} from "@/stores/chat/chat-diff-preferences-store";
import {
  resetFileTreeStoreForTests,
  useFileTreeStore,
} from "@/stores/editor/file-tree-store";
import {
  readHomeNextTargetSelectionState,
  resetHomeNextTargetSelectionForTests,
} from "@/hooks/home/ui/use-home-next-target-selection-state";
import {
  isCloudDisplayNameBackfillSuppressed,
  resetCloudDisplayNameSuppressionForTests,
} from "@/hooks/workspaces/lifecycle/cloud-display-name-backfill-suppression";
import {
  isReplacedSessionTombstoned,
  resetReplacedSessionTombstonesForTests,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import { resetSessionReplacementTombstonesStorageForTests } from "@/lib/access/persistence/session-replacement-tombstones-storage";
import { useProductStoragePersistenceLifecycle } from "./use-product-storage-persistence-lifecycle";

let memory: MemoryProductStorage;

function renderLifecycle() {
  const host = makeTestProductHost({ overrides: { storage: memory.storage } });
  return renderHook(() => useProductStoragePersistenceLifecycle(), {
    wrapper: productHostWrapper(host),
  });
}

beforeEach(() => {
  cleanup();
  resetChatDiffPreferencesForTests();
  resetFileTreeStoreForTests();
  resetHomeNextTargetSelectionForTests();
  resetCloudDisplayNameSuppressionForTests();
  resetReplacedSessionTombstonesForTests();
  resetSessionReplacementTombstonesStorageForTests();
  memory = createMemoryProductStorage();
});

afterEach(() => {
  cleanup();
  resetChatDiffPreferencesForTests();
  resetFileTreeStoreForTests();
  resetHomeNextTargetSelectionForTests();
  resetCloudDisplayNameSuppressionForTests();
  resetReplacedSessionTombstonesForTests();
  resetSessionReplacementTombstonesStorageForTests();
});

describe("useProductStoragePersistenceLifecycle", () => {
  it("wires and hydrates every module-singleton product store", async () => {
    memory.values.set("proliferate.chatDiffPreferences.v1", { wrapLongLines: true });
    memory.values.set("proliferate.fileTreeOverlay.v1", { width: 512 });
    memory.values.set("home_next_target_selection.v1", { destination: "repository" });
    memory.values.set("proliferate.cloudDisplayNameBackfillSuppression.v1", { "cloud-1": true });
    memory.values.set("proliferate.session-replacement-tombstones.v1", {
      "workspace-1": [{ runtimeSessionId: "runtime-old", suppressedSessionIds: ["runtime-old"] }],
    });

    renderLifecycle();

    await waitFor(() => {
      expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(true);
      expect(useFileTreeStore.getState().width).toBe(512);
      expect(readHomeNextTargetSelectionState().destination).toBe("repository");
      expect(isCloudDisplayNameBackfillSuppressed("cloud-1")).toBe(true);
      expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
    });
  });

  it("ignores late hydration reads after unmount", async () => {
    memory.values.set("proliferate.chatDiffPreferences.v1", { wrapLongLines: true });
    // Delay the read so it resolves after unmount.
    memory.storage.getItem = () =>
      new Promise((resolve) => setTimeout(() => resolve(JSON.stringify({ wrapLongLines: true })), 0));

    const { unmount } = renderLifecycle();
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(false);
  });
});
