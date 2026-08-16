import { Outlet } from "react-router-dom"
import { ProliferateLivingMark } from "#product/components/brand/ProliferateLivingMark"
import { LoadingBoundary } from "#product/primitives/LoadingBoundary"
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store"

export function UserPreferencesGate() {
  const preferencesHydrated = useUserPreferencesStore((state) => state._hydrated)

  return <UserPreferencesGateView preferencesHydrated={preferencesHydrated} />
}

// The app-boot preferences gate (UX Latency + Transitions ADR §4.3, Rung 3;
// ruled Class A because it gates the whole shell). This component governs its
// own life the same way `TranscriptSwitchingPlaceholder` does: it only mounts
// while preferences are unhydrated, so it holds `state="pending"` for its
// whole life and unmounts itself (rendering `Outlet` instead) once hydration
// resolves. Routing through `LoadingBoundary` still buys the 200ms show-delay
// so a hydration that finishes before the window never flashes the mark.
export function UserPreferencesGateView({
  preferencesHydrated,
}: {
  preferencesHydrated: boolean
}) {
  if (!preferencesHydrated) {
    return (
      <LoadingBoundary
        state="pending"
        diagnostics={{ flow: "user_preferences_gate" }}
        className="flex min-h-screen items-center justify-center bg-background p-8"
        treatment={<ProliferateLivingMark />}
      />
    )
  }

  return <Outlet />
}
