import { Navigate, Outlet } from "react-router-dom"
import { LoadingState } from "@/components/feedback/LoadingIllustration"
import { AUTH_GATE_LABELS } from "@/copy/auth/auth-copy"
import { useAuthStore } from "@/stores/auth/auth-store"

export function BootstrappedRoute() {
  const status = useAuthStore((state) => state.status)

  if (status === "bootstrapping") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <LoadingState
          message={AUTH_GATE_LABELS.loadingMessage}
          subtext={AUTH_GATE_LABELS.loadingSubtext}
        />
      </div>
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
