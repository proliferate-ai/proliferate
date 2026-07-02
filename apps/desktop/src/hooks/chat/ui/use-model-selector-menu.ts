import { useCallback, useMemo, useRef, useState } from "react";
import {
  filterModelSelectorGroups,
} from "@/lib/domain/chat/models/model-selector-filtering";
import type {
  ModelSelectorGroup,
} from "@/lib/domain/chat/models/model-selector-types";

interface UseModelSelectorMenuArgs {
  groups: ModelSelectorGroup[];
}

export function useModelSelectorMenu({
  groups,
}: UseModelSelectorMenuArgs) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ bottom: number; left: number } | null>(null);

  const filteredGroups = useMemo(
    () => filterModelSelectorGroups(groups, search),
    [groups, search],
  );

  const handleClose = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  const handleOpen = useCallback(() => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPos({
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left,
      });
    }

    setOpen((value) => !value);
    setSearch("");
  }, [open]);

  return {
    open,
    search,
    triggerRef,
    menuPos,
    filteredGroups,
    setSearch,
    handleOpen,
    handleClose,
  };
}
