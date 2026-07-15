import { create } from "zustand";
import {
  readPersistedJson,
  writePersistedJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

export const FILE_TREE_STORAGE_KEY = "proliferate.fileTreeOverlay.v1";

interface FileTreeState {
  width: number;
  expandedPaths: Set<string>;

  setWidth: (width: number) => void;
  toggleExpanded: (path: string) => void;
  setExpanded: (path: string, expanded: boolean) => void;
  collapseAll: () => void;
}

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 280;
const MAX_WIDTH_RATIO = 0.6;

export { MIN_WIDTH as FILE_TREE_MIN_WIDTH, MAX_WIDTH_RATIO as FILE_TREE_MAX_WIDTH_RATIO };

// Module singleton: persistence backend is injected once at the product
// lifecycle mount (see `useFileTreeStorePersistence`). Only `width` is
// persisted; `expandedPaths` is intentionally session-only and always resets to
// empty on load.
let storageContext: ProductStorageContext | null = null;
let hasUserWritten = false;

export function setFileTreeStoreStorageContext(
  context: ProductStorageContext | null,
): void {
  storageContext = context;
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  width: DEFAULT_WIDTH,
  expandedPaths: new Set<string>(),

  setWidth: (width) => {
    const clamped = Math.max(MIN_WIDTH, width);
    hasUserWritten = true;
    set({ width: clamped });
    persistWidth(clamped);
  },

  toggleExpanded: (path) => {
    const next = new Set(get().expandedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    set({ expandedPaths: next });
  },

  setExpanded: (path, expanded) => {
    const next = new Set(get().expandedPaths);
    if (expanded) {
      next.add(path);
    } else {
      next.delete(path);
    }
    set({ expandedPaths: next });
  },

  collapseAll: () => {
    set({ expandedPaths: new Set() });
  },
}));

function persistWidth(width: number): void {
  if (!storageContext) {
    return;
  }
  void writePersistedJson(storageContext, FILE_TREE_STORAGE_KEY, { width });
}

/**
 * One-shot hydration of the persisted overlay width through the injected
 * ProductStorage. A read resolving after a user resize (or after unmount, via
 * `isStale`) is ignored so a late read never overwrites live state.
 */
export async function hydrateFileTreeStore(
  context: ProductStorageContext,
  isStale?: () => boolean,
): Promise<void> {
  const result = await readPersistedJson<number>(context, FILE_TREE_STORAGE_KEY, {
    parse: (raw) =>
      raw
      && typeof raw === "object"
      && "width" in raw
      && typeof (raw as { width: unknown }).width === "number"
        ? Math.max(MIN_WIDTH, (raw as { width: number }).width)
        : DEFAULT_WIDTH,
    fallback: DEFAULT_WIDTH,
    isStale,
  });
  if (result.status !== "settled" || hasUserWritten) {
    return;
  }
  useFileTreeStore.setState({ width: result.value });
}

export function resetFileTreeStoreForTests(): void {
  storageContext = null;
  hasUserWritten = false;
  useFileTreeStore.setState({ width: DEFAULT_WIDTH, expandedPaths: new Set() });
}
