import { useEffect, useRef } from "react"
import { isApplePlatform } from "@/lib/domain/shortcuts/matching"
import { useShortcutRevealStore } from "@/stores/shortcuts/shortcut-reveal-store"

export const SHORTCUT_REVEAL_DELAY_MS = 1000
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
  const timerRef = useRef<number | null>(null)
  const primaryDownRef = useRef(false)

  useEffect(() => {
    const clearReveal = () => {
      primaryDownRef.current = false
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setStoreVisible(false)
    }

    const startRevealTimer = () => {
      if (timerRef.current) {
        return
      }

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (primaryDownRef.current) {
          setStoreVisible(true)
        }
      }, SHORTCUT_REVEAL_DELAY_MS)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const isApple = isApplePlatform()
      const primaryPressed = primaryModifierPressed(event, isApple)

      if (!primaryPressed) {
        clearReveal()
        return
      }

      if (!isModifierKey(event.key)) {
        clearReveal()
        return
      }

      if (isPrimaryModifierKey(event.key, isApple)) {
        primaryDownRef.current = true
        if (!event.repeat) {
          startRevealTimer()
        }
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
