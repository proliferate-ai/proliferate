import { PageContentFrame } from "@/components/ui/PageContentFrame";
import { PageHeader } from "@/components/ui/PageHeader";
import { MainSidebarPageShell } from "@/components/workspace/shell/MainSidebarPageShell";
import { ConnectorCatalogPage } from "./ConnectorCatalogPage";

export function PowersScreen() {
  return (
    <MainSidebarPageShell>
      <PageContentFrame
        stickyTitle="Powers"
        header={(
          <PageHeader
            title="Powers"
            description="Integrations Proliferate can use inside every session."
          />
        )}
      >
        <ConnectorCatalogPage />
      </PageContentFrame>
    </MainSidebarPageShell>
  );
}
