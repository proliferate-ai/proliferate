import { type ReactNode } from "react"
import { useShortcutRevealState } from "@/hooks/shortcuts/lifecycle/use-shortcut-reveal-state"
import { useShortcutRevealStore } from "@/stores/shortcuts/shortcut-reveal-store"

export function ShortcutRevealProvider({ children }: { children: ReactNode }) {
  useShortcutRevealState()

  return <>{children}</>
}

export function useShortcutRevealVisible(): boolean {
  return useShortcutRevealStore((state) => state.visible)
}
