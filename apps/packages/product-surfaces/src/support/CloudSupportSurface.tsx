import {
  sendSupportMessage,
  type SupportMessageContext,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "@proliferate/cloud-sdk-react";
import { SupportSurface } from "@proliferate/product-ui/support/SupportSurface";

export interface CloudSupportSurfaceProps {
  context: SupportMessageContext;
}

export function CloudSupportSurface({ context }: CloudSupportSurfaceProps) {
  const client = useCloudClient();

  return (
    <SupportSurface
      onSubmit={(message) =>
        sendSupportMessage(
          {
            message,
            context,
          },
          client,
        )
      }
    />
  );
}
