import { createContext, useContext, type ReactNode } from "react"
import { useShortcutRevealState } from "@/hooks/shortcuts/lifecycle/use-shortcut-reveal-state"

const ShortcutRevealContext = createContext(false)

export function ShortcutRevealProvider({ children }: { children: ReactNode }) {
  const visible = useShortcutRevealState()

  return (
    <ShortcutRevealContext.Provider value={visible}>
      {children}
    </ShortcutRevealContext.Provider>
  )
}

export function useShortcutRevealVisible(): boolean {
  return useContext(ShortcutRevealContext)
}
