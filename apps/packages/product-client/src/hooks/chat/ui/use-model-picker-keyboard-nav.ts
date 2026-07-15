import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  ModelSelectorGroup,
  ModelSelectorSelection,
} from "#product/lib/domain/chat/models/model-selector-types";

export function modelRowKey(kind: string, modelId: string): string {
  return `${kind}:${modelId}`;
}

/**
 * Keyboard navigation for the composer model picker: focus stays in the
 * search field; ArrowUp/ArrowDown move a roving highlight over the flattened
 * model rows and Enter selects it (mirrors the slash-command menu's
 * single-focus-owner pattern). Rows are keyed `${kind}:${modelId}` so the
 * highlight survives refiltering; when the highlighted row is filtered out,
 * the highlight falls back to the selected model, else the first row.
 */
export function useModelPickerKeyboardNav(
  filteredGroups: ModelSelectorGroup[],
  onSelect: (selection: ModelSelectorSelection) => void,
) {
  const flatModelKeys = useMemo(
    () => filteredGroups.flatMap((group) =>
      group.models.map((model) => modelRowKey(group.kind, model.modelId))
    ),
    [filteredGroups],
  );
  const selectionByKey = useMemo(() => {
    const byKey = new Map<string, ModelSelectorSelection>();
    for (const group of filteredGroups) {
      for (const model of group.models) {
        byKey.set(modelRowKey(group.kind, model.modelId), {
          kind: group.kind,
          modelId: model.modelId,
        });
      }
    }
    return byKey;
  }, [filteredGroups]);
  const initialHighlightKey = useMemo(() => {
    for (const group of filteredGroups) {
      const selected = group.models.find((model) => model.isSelected);
      if (selected) {
        return modelRowKey(group.kind, selected.modelId);
      }
    }
    return flatModelKeys[0] ?? null;
  }, [filteredGroups, flatModelKeys]);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(initialHighlightKey);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const effectiveHighlightedKey =
    highlightedKey && flatModelKeys.includes(highlightedKey)
      ? highlightedKey
      : initialHighlightKey;

  const setRowRef = useCallback((key: string, element: HTMLButtonElement | null) => {
    if (element) {
      rowRefs.current.set(key, element);
    } else {
      rowRefs.current.delete(key);
    }
  }, []);

  const moveHighlight = useCallback((delta: number) => {
    if (flatModelKeys.length === 0) {
      return;
    }
    const currentIndex = effectiveHighlightedKey
      ? flatModelKeys.indexOf(effectiveHighlightedKey)
      : -1;
    const nextIndex = Math.min(
      flatModelKeys.length - 1,
      Math.max(0, (currentIndex < 0 ? (delta > 0 ? -1 : 0) : currentIndex) + delta),
    );
    const nextKey = flatModelKeys[nextIndex];
    if (nextKey !== undefined) {
      setHighlightedKey(nextKey);
      rowRefs.current.get(nextKey)?.scrollIntoView({ block: "nearest" });
    }
  }, [effectiveHighlightedKey, flatModelKeys]);

  // Refiltering can leave the effective highlight on a row that just scrolled
  // out of the visible window; keep it in view.
  useEffect(() => {
    if (effectiveHighlightedKey) {
      rowRefs.current.get(effectiveHighlightedKey)?.scrollIntoView({ block: "nearest" });
    }
  }, [effectiveHighlightedKey]);

  const handleSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selection = effectiveHighlightedKey
        ? selectionByKey.get(effectiveHighlightedKey)
        : undefined;
      if (selection) {
        onSelect(selection);
      }
    }
  }, [effectiveHighlightedKey, moveHighlight, onSelect, selectionByKey]);

  return {
    highlightedKey: effectiveHighlightedKey,
    setHighlightedKey,
    setRowRef,
    handleSearchKeyDown,
  };
}
