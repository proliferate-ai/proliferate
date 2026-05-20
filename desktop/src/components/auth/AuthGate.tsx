import { useCallback, useEffect, useState } from "react"
import { Navigate, Outlet } from "react-router-dom"
import { SessionCheckScreen } from "@/components/auth/SessionCheckScreen"
import { useAuthStore } from "@/stores/auth/auth-store"

type SessionCheckOverlayState = "checking" | "resolving" | "fading" | null

export function BootstrappedRoute() {
  const status = useAuthStore((state) => state.status)
  const [overlayState, setOverlayState] = useState<SessionCheckOverlayState>(
    status === "bootstrapping" ? "checking" : null,
  )

  useEffect(() => {
    if (status === "bootstrapping") {
      setOverlayState("checking")
      return
    }

    setOverlayState((current) => (current === "checking" ? "resolving" : current))
  }, [status])

  const handleResolved = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setOverlayState("fading")
      })
    })
  }, [])

  const handleFadeComplete = useCallback(() => {
    setOverlayState(null)
  }, [])

  useEffect(() => {
    if (overlayState !== "fading") {
      return
    }

    const timeout = window.setTimeout(handleFadeComplete, 220)
    return () => window.clearTimeout(timeout)
  }, [handleFadeComplete, overlayState])

  if (status === "bootstrapping" || overlayState) {
    return (
      <>
        {status !== "bootstrapping" && <Outlet />}
        <div
          className={`fixed inset-0 z-50 bg-background transition-opacity duration-200 motion-reduce:transition-none ${
            overlayState === "fading" ? "opacity-0" : "opacity-100"
          }`}
          onTransitionEnd={overlayState === "fading" ? handleFadeComplete : undefined}
        >
          <SessionCheckScreen
            resolving={overlayState === "resolving" || overlayState === "fading"}
            onResolved={handleResolved}
          />
        </div>
      </>
    )
  }

  return <Outlet />
}

export function PublicOnlyRoute() {
  const status = useAuthStore((state) => state.status)

  if (status === "authenticated") {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
