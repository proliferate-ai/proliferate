import { useCallback, useEffect, useState } from "react"
import { Navigate, Outlet } from "react-router-dom"
import { twMerge } from "@proliferate/ui/utils/tw-merge"
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider"
import type { AuthState } from "@proliferate/product-client/host/product-host"
import { AuthShell } from "@/components/auth/AuthShell"

// Where the gate resolves to once auth state is known:
//   loading -> still bootstrapping (mark breathing)
//   app     -> reveal the workspace (authenticated, or auth not required)
//   login   -> stay on the sign-in screen (anonymous + auth required)
type GateDestination = "loading" | "app" | "login"

// Tracks the mark-settle -> fade-out lifecycle for the app reveal only.
type ShellFadeState = "checking" | "resolving" | "fading" | null

function resolveDestination(
  status: AuthState["status"],
  authRequired: boolean,
): GateDestination {
  if (status === "loading") {
    return "loading"
  }
  if (status === "authenticated" || !authRequired) {
    return "app"
  }
  return "login"
}

export function BootstrappedRoute() {
  const { auth } = useProductHost()
  const status = auth.state.status
  const authRequired = auth.authRequired
  const destination = resolveDestination(status, authRequired)

  const [fadeState, setFadeState] = useState<ShellFadeState>(
    status === "loading" ? "checking" : null,
  )
  // The living mark settled to its resolved icon at least once. Tracked as state
  // (not derived from the mark callback alone) because the SAME persistent mark
  // only fires onResolved once — when revealing the app after the login screen,
  // it has already resolved and won't fire again, so the reveal fade must key off
  // this instead. Without it the shell would stay mounted forever after sign-in.
  const [markResolved, setMarkResolved] = useState(false)

  useEffect(() => {
    if (status === "loading") {
      setFadeState("checking")
      setMarkResolved(false)
      return
    }
    setFadeState((current) => (current === "checking" ? "resolving" : current))
  }, [status])

  const handleResolved = useCallback(() => setMarkResolved(true), [])
  const handleFadeComplete = useCallback(() => setFadeState(null), [])

  // Reveal the app once the mark has settled and we're heading to the app. Runs
  // for both the first-load reveal (bootstrapping -> app) and the post-sign-in
  // reveal (login -> app), where the persistent mark already resolved.
  useEffect(() => {
    if (destination !== "app" || !markResolved) {
      return
    }
    if (fadeState === null || fadeState === "fading") {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setFadeState("fading"))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [destination, markResolved, fadeState])

  useEffect(() => {
    if (destination !== "app" || fadeState !== "fading") {
      return
    }
    const timeout = window.setTimeout(handleFadeComplete, 220)
    return () => window.clearTimeout(timeout)
  }, [destination, fadeState, handleFadeComplete])

  // App fully revealed: the shell is gone, only the workspace remains.
  if (destination === "app" && fadeState === null) {
    return <Outlet />
  }

  const shellMode = destination === "login" ? "auth" : "loading"
  const markComplete = destination !== "loading"
  const isFadingOut = destination === "app" && fadeState === "fading"

  return (
    <>
      {/* The workspace mounts behind the shell during the reveal fade. */}
      {destination === "app" && <Outlet />}
      <div
        className={twMerge(
          "fixed inset-0 z-50 bg-background",
          destination === "app"
          && "transition-opacity duration-200 motion-reduce:transition-none",
          isFadingOut ? "opacity-0" : "opacity-100",
        )}
        onTransitionEnd={isFadingOut ? handleFadeComplete : undefined}
      >
        <AuthShell
          mode={shellMode}
          markComplete={markComplete}
          onMarkResolved={handleResolved}
        />
      </div>
    </>
  )
}

export function PublicOnlyRoute() {
  const status = useProductHost().auth.state.status

  if (status === "authenticated") {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
