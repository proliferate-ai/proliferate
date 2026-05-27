import { Children, isValidElement, useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import { MobilePopoverGroupContext } from "./popover-context";

interface MobilePopoverGroupProps {
  expandedId?: string | null;
  onExpandedChange?: (id: string | null) => void;
  children: React.ReactNode;
}

export function MobilePopoverGroup({
  expandedId: controlledExpandedId,
  onExpandedChange,
  children,
}: MobilePopoverGroupProps) {
  const [uncontrolledExpandedId, setUncontrolledExpandedId] = useState<string | null>(null);
  const controlled = controlledExpandedId !== undefined;
  const expandedId = controlled ? (controlledExpandedId ?? null) : uncontrolledExpandedId;

  const setExpandedId = useCallback(
    (id: string | null) => {
      if (!controlled) {
        setUncontrolledExpandedId(id);
      }
      onExpandedChange?.(id);
    },
    [controlled, onExpandedChange],
  );

  const idIndexRef = useRef<Map<string, number>>(new Map());
  const orderRef = useRef<string[]>([]);

  const registerIndex = useCallback((id: string) => {
    const existing = idIndexRef.current.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const index = orderRef.current.length;
    orderRef.current.push(id);
    idIndexRef.current.set(id, index);
    return index;
  }, []);

  const expandedIndex = useMemo(() => {
    if (expandedId == null) {
      return -1;
    }
    return idIndexRef.current.get(expandedId) ?? -1;
  }, [expandedId]);

  const isDimmed = useCallback(
    (index: number) => expandedIndex >= 0 && index < expandedIndex,
    [expandedIndex],
  );

  const value = useMemo(
    () => ({ expandedId, setExpandedId, registerIndex, isDimmed }),
    [expandedId, setExpandedId, registerIndex, isDimmed],
  );

  return (
    <MobilePopoverGroupContext.Provider value={value}>
      <View>{Children.map(children, (child) => (isValidElement(child) ? child : null))}</View>
    </MobilePopoverGroupContext.Provider>
  );
}
