import type { ConnectorModalTab } from "@/lib/domain/mcp/connector-catalog-view-model";
import { Button } from "@proliferate/ui/primitives/Button";

const TAB_LABELS: Record<ConnectorModalTab, string> = {
  configure: "Configure",
  tools: "Tools",
  about: "About",
};

const TABS: readonly ConnectorModalTab[] = ["configure", "tools", "about"];

export function ConnectorDetailTabs({
  activeTab,
  onSetTab,
}: {
  activeTab: ConnectorModalTab;
  onSetTab: (tab: ConnectorModalTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className="flex shrink-0 gap-4 border-b border-border/60 px-5"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab;
        return (
          <Button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            variant="unstyled"
            size="unstyled"
            onClick={() => onSetTab(tab)}
            className={`-mb-px border-b-[1.5px] py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[tab]}
          </Button>
        );
      })}
    </div>
  );
}
