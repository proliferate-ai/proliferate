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
            description="Integrations Proliferate can use inside every session."
          />
        )}
      >
        {/* Plugins is the product surface; Connector names are the internal catalog model. */}
        <ConnectorCatalogPage />
      </PageContentFrame>
    </MainSidebarPageShell>
  );
}
