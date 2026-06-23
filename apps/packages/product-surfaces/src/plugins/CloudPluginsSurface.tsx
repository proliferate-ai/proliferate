import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { PluginsSurface } from "@proliferate/product-ui/plugins/PluginsSurface";
import type { CloudPluginsSurfaceProps } from "./cloud-plugin-surface-types";
import { useCloudPluginsSurfaceController } from "./useCloudPluginsSurfaceController";

export type {
  CloudPluginsLocalOAuthAdapter,
  CloudPluginsSurfaceProps,
  PluginOAuthCompletionState,
  PluginOAuthHandoff,
} from "./cloud-plugin-surface-types";

export function CloudPluginsSurface(props: CloudPluginsSurfaceProps) {
  const surfaceProps = useCloudPluginsSurfaceController(props);

  return (
    <ProductPageShell
      title="Integrations"
      description="Apps, MCP tools, and skills agents can use in sessions."
      maxWidthClassName="max-w-6xl"
      telemetryBlocked
    >
      <PluginsSurface {...surfaceProps} />
    </ProductPageShell>
  );
}
