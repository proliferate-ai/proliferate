import { Outlet } from "react-router-dom"
import { LoadingState } from "@/components/feedback/LoadingIllustration"
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store"

const LOADING_MESSAGE = "Restoring your setup"
const LOADING_SUBTEXT = "Loading your saved preferences before opening Proliferate."

export function UserPreferencesGate() {
  const preferencesHydrated = useUserPreferencesStore((state) => state._hydrated)

  return <UserPreferencesGateView preferencesHydrated={preferencesHydrated} />
}

export function UserPreferencesGateView({
  preferencesHydrated,
}: {
  preferencesHydrated: boolean
}) {
  if (!preferencesHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <LoadingState message={LOADING_MESSAGE} subtext={LOADING_SUBTEXT} />
      </div>
    )
  }

  return <Outlet />
}
