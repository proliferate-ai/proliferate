import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { SupportSurface } from "@proliferate/product-ui/support/SupportSurface";

export function SupportScreen() {
  return (
    <ProductPageShell
      title="Get help"
      description="Support for cloud sessions and Desktop handoff."
      telemetryBlocked
    >
      <SupportSurface />
    </ProductPageShell>
  );
}
