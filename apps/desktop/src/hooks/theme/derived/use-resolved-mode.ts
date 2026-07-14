import { useSyncExternalStore } from "react";
import {
  getResolvedMode,
  subscribe,
} from "#product/config/theme";

export function useResolvedMode(): "dark" | "light" {
  return useSyncExternalStore(subscribe, getResolvedMode, getResolvedMode);
}
