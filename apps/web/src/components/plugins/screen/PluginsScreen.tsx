import { SlidersHorizontal } from "lucide-react";

import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { PluginAccessList } from "@proliferate/product-ui/plugins/PluginAccessList";
import { Button } from "@proliferate/ui/primitives/Button";
import { plugins } from "../../../lib/fixtures/web-fixtures";

export function PluginsScreen() {
  return (
    <ProductPageShell
      title="Shared sandbox access"
      description="Plugins and MCPs available to cloud workspaces, automations, and Slack."
      actions={
        <Button variant="secondary" size="md">
          <SlidersHorizontal size={15} />
          Configure
        </Button>
      }
      telemetryBlocked
    >
      <PluginAccessList items={plugins} />
    </ProductPageShell>
  );
}
