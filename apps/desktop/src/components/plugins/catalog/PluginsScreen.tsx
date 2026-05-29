import { PageContentFrame } from "@/components/ui/PageContentFrame";
import { PageHeader } from "@/components/ui/PageHeader";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { ConnectorCatalogPage } from "./ConnectorCatalogPage";

export function PluginsScreen() {
  return (
    <MainSidebarPageShell>
      <PageContentFrame
        stickyTitle="Plugins"
        header={(
          <PageHeader
            title="Plugins"
            description="Packages of apps, MCP tools, and skills agents can use in sessions."
          />
        )}
      >
        {/* Plugins is the product surface; Connector names are the internal catalog model. */}
        <ConnectorCatalogPage />
      </PageContentFrame>
    </MainSidebarPageShell>
  );
}
