import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen";

export function DesktopHandoffPage() {
  const desktopHref = "proliferate://";

  return (
    <RedirectCallbackScreen
      title="Desktop handoff done"
      description="Redirecting to desktop app..."
      statusLabel="Desktop handoff"
      variant="handoff"
      primaryAction={{
        label: "Click here if not redirected",
        onClick: () => window.location.assign(desktopHref),
      }}
    />
  );
}
