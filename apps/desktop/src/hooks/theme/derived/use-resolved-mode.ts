import { useSyncExternalStore } from "react";
import {
  getResolvedMode,
  subscribe,
} from "@/config/theme";

export function useResolvedMode(): "dark" | "light" {
  return useSyncExternalStore(subscribe, getResolvedMode, getResolvedMode);
}
