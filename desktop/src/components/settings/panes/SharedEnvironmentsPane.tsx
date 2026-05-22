import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@/components/ui/Badge";
import { APP_ROUTES } from "@/config/app-routes";
import type { SettingsSection } from "@/config/settings";
import { AdminOnlyPlaceholder } from "@/components/settings/shared/AdminOnlyPlaceholder";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";

interface SharedEnvironmentsPaneProps {
  isAdmin: boolean;
  isCheckingAdmin: boolean;
  role: string | null;
  onOpenSettingsSection: (section: SettingsSection) => void;
}

export function SharedEnvironmentsPane({
  isAdmin,
  isCheckingAdmin,
  role,
  onOpenSettingsSection,
}: SharedEnvironmentsPaneProps) {
  const navigate = useNavigate();

  if (isCheckingAdmin) {
    return (
      <SharedEnvironmentsShell>
        <SettingsCard>
          <div className="p-3 text-sm text-muted-foreground">Checking admin access...</div>
        </SettingsCard>
      </SharedEnvironmentsShell>
    );
  }

  if (!isAdmin) {
    return (
      <SharedEnvironmentsShell>
        <AdminOnlyPlaceholder
          role={role}
          onOpenOrganization={() => onOpenSettingsSection("organization")}
        />
      </SharedEnvironmentsShell>
    );
  }

  return (
    <SharedEnvironmentsShell>
      <SettingsCard>
        <SettingsCardRow
          label="Agents"
          description="Choose which harnesses are installed and available across shared workspaces."
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenSettingsSection("agents")}
          >
            Open
          </Button>
        </SettingsCardRow>
        <SettingsCardRow
          label="Plugins & MCPs"
          description="Manage MCP servers and skill plugins enabled across shared workspaces."
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate(APP_ROUTES.plugins)}
          >
            Open
          </Button>
        </SettingsCardRow>
        <SettingsCardRow
          label="Agent Authentication"
          description="Configure org-wide credentials and synced auth used by shared workspaces."
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenSettingsSection("agent-authentication")}
          >
            Open
          </Button>
        </SettingsCardRow>
        <SettingsCardRow
          label="Compute"
          description="Review shared runtime readiness and target health."
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenSettingsSection("compute")}
          >
            Open
          </Button>
        </SettingsCardRow>
      </SettingsCard>
    </SharedEnvironmentsShell>
  );
}

function SharedEnvironmentsShell({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Shared environments"
        description="Org-wide environment configuration for shared workspaces. Agents, plugins, and authentication for shared workspaces are managed in their own settings pages."
        action={<Badge>Admin</Badge>}
      />
      {children}
    </section>
  );
}
