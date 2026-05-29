import { useLocation } from "react-router-dom";
import { sendSupportMessage } from "@proliferate/cloud-sdk";
import { useCloudClient } from "@proliferate/cloud-sdk-react";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { SupportSurface } from "@proliferate/product-ui/support/SupportSurface";

export function SupportScreen() {
  const client = useCloudClient();
  const location = useLocation();

  return (
    <ProductPageShell
      title="Get help"
      description="Support for cloud sessions and Desktop handoff."
      telemetryBlocked
    >
      <SupportSurface
        onSubmit={(message) =>
          sendSupportMessage(
            {
              message,
              context: {
                source: "sidebar",
                intent: "general",
                pathname: `${location.pathname}${location.search}${location.hash}`,
              },
            },
            client,
          )
        }
      />
    </ProductPageShell>
  );
}
