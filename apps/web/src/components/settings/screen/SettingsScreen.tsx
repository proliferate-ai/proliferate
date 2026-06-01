import { CircleUserRound, CreditCard, GitBranch, LifeBuoy, UsersRound } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import {
  normalizeCloudSettingsSectionId,
  WEB_CLOUD_SETTINGS_SECTIONS,
  type CloudSettingsIconToken,
} from "@proliferate/product-domain/settings/cloud-settings";
import { SettingsShell } from "@proliferate/product-ui/settings/SettingsShell";

import { routes } from "../../../config/routes";
import { AccountSettingsSection } from "./AccountSettingsSection";
import { BillingSettingsSection } from "./BillingSettingsSection";
import { EnvironmentsSettingsSection } from "./EnvironmentsSettingsSection";
import { OrganizationSettingsSection } from "./OrganizationSettingsSection";
import { SupportSettingsSection } from "./SupportSettingsSection";

const SETTINGS_ICON_SIZE = 14;

export function SettingsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sectionId } = useParams();
  const activeSection = normalizeCloudSettingsSectionId(sectionId);

  return (
    <div className="h-full" data-telemetry-block>
      <SettingsShell
        activeSectionId={activeSection}
        groups={[
          {
            items: WEB_CLOUD_SETTINGS_SECTIONS.map((section) => ({
              id: section.id,
              label: section.label,
              icon: settingsIcon(section.iconToken),
            })),
          },
        ]}
        onSelectSection={(id) => {
          navigate(routes.settingsSection(normalizeCloudSettingsSectionId(id)), {
            state: settingsNavigationState(location.state),
          });
        }}
        contentClassName={activeSection === "billing" ? "max-w-6xl" : undefined}
      >
        {activeSection === "account" ? (
          <AccountSettingsSection />
        ) : activeSection === "environments" ? (
          <EnvironmentsSettingsSection />
        ) : activeSection === "organization" ? (
          <OrganizationSettingsSection />
        ) : activeSection === "billing" ? (
          <BillingSettingsSection />
        ) : (
          <SupportSettingsSection onOpenSupport={() => navigate(routes.support)} />
        )}
      </SettingsShell>
    </div>
  );
}

function settingsNavigationState(state: unknown): unknown {
  if (
    state &&
    typeof state === "object" &&
    "backgroundLocation" in state
  ) {
    return state;
  }
  return undefined;
}

function settingsIcon(token: CloudSettingsIconToken) {
  switch (token) {
    case "account":
      return <CircleUserRound size={SETTINGS_ICON_SIZE} />;
    case "branch":
      return <GitBranch size={SETTINGS_ICON_SIZE} />;
    case "organization":
      return <UsersRound size={SETTINGS_ICON_SIZE} />;
    case "billing":
      return <CreditCard size={SETTINGS_ICON_SIZE} />;
    case "support":
      return <LifeBuoy size={SETTINGS_ICON_SIZE} />;
  }
}
