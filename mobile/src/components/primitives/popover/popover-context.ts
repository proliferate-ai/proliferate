import { createContext, useContext, type ReactNode, type RefObject } from "react";
import type { View } from "react-native";

export interface MobilePopoverGroupContextValue {
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  registerIndex: (id: string) => number;
  isDimmed: (index: number) => boolean;
}

export const MobilePopoverGroupContext =
  createContext<MobilePopoverGroupContextValue | null>(null);

export function useMobilePopoverGroup(): MobilePopoverGroupContextValue | null {
  return useContext(MobilePopoverGroupContext);
}

export interface MobilePopoverOverlay {
  content: ReactNode;
  top: number;
}

export interface MobilePopoverContextValue {
  cardRef: RefObject<View | null>;
  setOverlay: (overlay: MobilePopoverOverlay | null) => void;
  cardHeight: number;
}

export const MobilePopoverContext =
  createContext<MobilePopoverContextValue | null>(null);

export function useMobilePopover(): MobilePopoverContextValue | null {
  return useContext(MobilePopoverContext);
}
