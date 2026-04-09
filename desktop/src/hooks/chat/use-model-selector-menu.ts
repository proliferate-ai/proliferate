import { useCallback, useMemo, useRef, useState } from "react";
import type { AgentSummary } from "@anyharness/sdk";
import {
  filterModelSelectorGroups,
  type ModelSelectorGroup,
} from "@/lib/domain/chat/model-selection";

interface UseModelSelectorMenuArgs {
  groups: ModelSelectorGroup[];
}

export function useModelSelectorMenu({
  groups,
}: UseModelSelectorMenuArgs) {
  const [open, setOpen] = useState(false);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [setupAgent, setSetupAgent] = useState<AgentSummary | null>(null);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ bottom: number; left: number } | null>(null);

  const filteredGroups = useMemo(
    () => filterModelSelectorGroups(groups, search),
    [groups, search],
  );

  const handleClose = useCallback(() => {
    setOpen(false);
    setAddProviderOpen(false);
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
    setAddProviderOpen(false);
    setSearch("");
  }, [open]);

  const toggleAddProvider = useCallback(() => {
    setAddProviderOpen((value) => !value);
  }, []);

  const openSetupAgent = useCallback((agent: AgentSummary) => {
    handleClose();
    setSetupAgent(agent);
  }, [handleClose]);

  const closeSetupAgent = useCallback(() => {
    setSetupAgent(null);
  }, []);

  return {
    open,
    addProviderOpen,
    setupAgent,
    search,
    triggerRef,
    menuPos,
    filteredGroups,
    setSearch,
    handleOpen,
    handleClose,
    toggleAddProvider,
    openSetupAgent,
    closeSetupAgent,
  };
}
