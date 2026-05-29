import { useLocation } from "react-router-dom";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { CloudSupportSurface } from "@proliferate/product-surfaces/support/CloudSupportSurface";

export function SupportScreen() {
  const location = useLocation();
  const pathname = `${location.pathname}${location.search}${location.hash}`;

  return (
    <ProductPageShell
      title="Get help"
      description="Support for cloud sessions and Desktop handoff."
      telemetryBlocked
    >
      <CloudSupportSurface
        context={{
          source: "sidebar",
          intent: "general",
          pathname,
        }}
      />
    </ProductPageShell>
  );
}
