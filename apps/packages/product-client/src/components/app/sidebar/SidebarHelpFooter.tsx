import { CircleHelp } from "lucide-react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { SidebarAppVersionRow } from "#product/components/app/sidebar/SidebarAppVersionRow";
import { SidebarHelpSection } from "#product/components/app/sidebar/SidebarHelpSection";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useWebAppTarget } from "#product/hooks/capabilities/derived/use-web-app-target";
import { useOpenSupportReportWindow } from "#product/hooks/support/workflows/use-open-support-report-window";
import { useSupportMenuAction } from "#product/hooks/support/derived/use-support-menu-action";
import { useToastStore } from "#product/stores/toast/toast-store";

/** Help/support owns its own compact footer trigger and popover. */
export function SidebarHelpFooter() {
  const { openExternal } = useProductHost().links;
  const capabilities = useAppCapabilities();
  const webApp = useWebAppTarget();
  const supportAction = useSupportMenuAction();
  const {
    openBug: openSupport,
    openFeature: openPrompt,
    disabledReason: supportDisabledReason,
  } = useOpenSupportReportWindow({ source: "sidebar" });
  const showToast = useToastStore((state) => state.show);

  const openExternalUrl = (url: string) => {
    void openExternal(url).catch(() => {
      showToast("Failed to open the link.");
    });
  };

  return (
    <PopoverButton
      align="end"
      side="top"
      offset={8}
      trigger={(
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label="Open help menu"
          title="Help and support"
          className="size-10 rounded-lg text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground"
        >
          <CircleHelp className="icon-paired" />
        </Button>
      )}
      className={`w-64 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <div>
          <SidebarHelpSection
            webApp={webApp}
            supportAction={supportAction}
            supportDisabledReason={supportDisabledReason}
            openSupport={openSupport}
            openPrompt={openPrompt}
            openExternalUrl={openExternalUrl}
            onClose={close}
          />
          <SidebarAppVersionRow
            connectedServerName={
              capabilities.isSelfManaged ? capabilities.serverDisplayName : null
            }
          />
        </div>
      )}
    </PopoverButton>
  );
}
