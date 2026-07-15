import { useEffect } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen"
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider"

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"])

function desktopDeepLinkScheme(): "proliferate" | "proliferate-local" {
  return LOCALHOST_NAMES.has(window.location.hostname)
    ? "proliferate-local"
    : "proliferate"
}

function cloudSettingsPath(search: string): string {
  const nextParams = new URLSearchParams(search)
  nextParams.set("section", "billing")
  return `/settings?${nextParams.toString()}`
}

function cloudSettingsDeepLink(search: string): string {
  const url = new URL(`${desktopDeepLinkScheme()}://settings/cloud`)
  const params = new URLSearchParams(search)
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function StripeReturnHandoff({ deepLinkUrl }: { deepLinkUrl: string }) {
  useEffect(() => {
    window.location.replace(deepLinkUrl)
  }, [deepLinkUrl])

  return (
    <RedirectCallbackScreen
      title="Billing done"
      description="Redirecting to desktop app..."
      statusLabel="Billing redirect"
      variant="handoff"
      primaryAction={{
        label: "Click here if not redirected",
        onClick: () => window.location.assign(deepLinkUrl),
      }}
    />
  )
}

export function SettingsCloudRedirect() {
  const location = useLocation()
  // In a browser (no Desktop bridge) hand the Stripe return off to the desktop
  // app via deep link; on Desktop navigate in-app. `host.desktop !== null` is
  // the same distinction the raw `__TAURI_INTERNALS__` probe made pre-move.
  const isDesktop = useProductHost().desktop !== null
  if (!isDesktop) {
    return <StripeReturnHandoff deepLinkUrl={cloudSettingsDeepLink(location.search)} />
  }

  return <Navigate to={cloudSettingsPath(location.search)} replace />
}
