import { useEffect } from "react"
import { isApplePlatform } from "#product/lib/domain/shortcuts/matching"
import { useShortcutRevealStore } from "#product/stores/shortcuts/shortcut-reveal-store"

export const SHORTCUT_REVEAL_RESET_EVENT = "proliferate:shortcut-reveal-reset"

function isPrimaryModifierKey(key: string, isApple: boolean): boolean {
  return isApple ? key === "Meta" : key === "Control"
}

function isModifierKey(key: string): boolean {
  return key === "Meta"
    || key === "Control"
    || key === "Alt"
    || key === "Shift"
}

function primaryModifierPressed(event: KeyboardEvent, isApple: boolean): boolean {
  return isApple ? event.metaKey : event.ctrlKey
}

export function useShortcutRevealState(): boolean {
  const visible = useShortcutRevealStore((state) => state.visible)
  const setStoreVisible = useShortcutRevealStore((state) => state.setVisible)

  useEffect(() => {
    const clearReveal = () => {
      setStoreVisible(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const isApple = isApplePlatform()
      const primaryPressed = primaryModifierPressed(event, isApple)

      if (isPrimaryModifierKey(event.key, isApple)) {
        setStoreVisible(primaryPressed)
        return
      }

      if (!primaryPressed || !isModifierKey(event.key)) {
        clearReveal()
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      const isApple = isApplePlatform()
      if (
        isPrimaryModifierKey(event.key, isApple)
        || !primaryModifierPressed(event, isApple)
      ) {
        clearReveal()
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearReveal()
      }
    }

    window.addEventListener(SHORTCUT_REVEAL_RESET_EVENT, clearReveal)
    window.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("keyup", handleKeyUp, true)
    window.addEventListener("blur", clearReveal)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      clearReveal()
      window.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("keyup", handleKeyUp, true)
      window.removeEventListener("blur", clearReveal)
      window.removeEventListener(SHORTCUT_REVEAL_RESET_EVENT, clearReveal)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [setStoreVisible])

  return visible
}
