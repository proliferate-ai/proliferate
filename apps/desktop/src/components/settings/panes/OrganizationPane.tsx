import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { UpgradeGateDialog } from "@/components/billing/UpgradeGateDialog";
import { OrganizationBillingLinkSection } from "@/components/settings/panes/organization/OrganizationBillingLinkSection";
import { OrganizationSettingsCard } from "@/components/settings/panes/organization/OrganizationSettingsCard";
import { OrganizationSection } from "@/components/settings/panes/organization/OrganizationLogo";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { useOrganizationActions } from "@/hooks/access/cloud/organizations/use-organization-actions";
import {
  useCurrentTeamCheckout,
  useTeamCheckoutActions,
} from "@/hooks/access/cloud/billing/use-team-checkout";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { TEAM_UPGRADE_GATE_COPY } from "@/copy/billing/upgrade-gate-copy";
import { organizationLogoImageValidationError } from "@/lib/domain/organizations/logo-image";
import { useAuthStore } from "@/stores/auth/auth-store";

function readLogoImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Image could not be read."));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  });
}

export function OrganizationPane() {
  const authStatus = useAuthStore((state) => state.status);
  const {
    activeOrganization,
    activeOrganizationId,
    organizations,
    organizationsQuery,
  } = useActiveOrganization();
  const { openExternal } = useTauriShellActions();
  const actions = useOrganizationActions(activeOrganizationId);
  const [settingsName, setSettingsName] = useState("");
  const [settingsLogoImage, setSettingsLogoImage] = useState<string | null>(null);
  const [logoImageError, setLogoImageError] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [teamUpgradeGateOpen, setTeamUpgradeGateOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const teamCheckoutQuery = useCurrentTeamCheckout(authStatus === "authenticated");
  const teamCheckoutActions = useTeamCheckoutActions();

  useEffect(() => {
    setSettingsName(activeOrganization?.name ?? "");
    setSettingsLogoImage(activeOrganization?.logoImage ?? null);
    setLogoImageError(null);
  }, [activeOrganization?.id, activeOrganization?.logoImage, activeOrganization?.name]);

  async function handleUpdateOrganization(event: FormEvent) {
    event.preventDefault();
    await actions.updateOrganization({
      name: settingsName,
      logoImage: settingsLogoImage,
    });
  }

  async function handleLogoImageFile(file: File | null) {
    setLogoImageError(null);
    if (!file) {
      return;
    }
    const validationError = organizationLogoImageValidationError(file);
    if (validationError) {
      setLogoImageError(validationError);
      return;
    }
    try {
      setSettingsLogoImage(await readLogoImage(file));
    } catch {
      setLogoImageError("Image could not be read.");
    }
  }

  async function handleCreateTeamCheckout(event: FormEvent) {
    event.preventDefault();
    if (!newTeamName.trim()) {
      return;
    }
    setStatusMessage(null);
    teamCheckoutActions.resetCreateTeamCheckout();
    setTeamUpgradeGateOpen(true);
  }

  async function confirmCreateTeamCheckout() {
    const teamName = newTeamName.trim();
    if (!teamName) {
      return;
    }
    setStatusMessage(null);
    try {
      const response = await teamCheckoutActions.createTeamCheckout(teamName);
      setTeamUpgradeGateOpen(false);
      await openExternal(response.url);
    } catch {
      // React Query exposes the error through createTeamCheckoutError for the dialog.
    }
  }

  async function handleContinueTeamCheckout(url: string) {
    await openExternal(url);
  }

  const shouldShowSignInState = authStatus !== "authenticated";
  const shouldShowLoadingState = authStatus === "authenticated" && organizationsQuery.isLoading;
  const shouldShowErrorState = authStatus === "authenticated" && organizationsQuery.isError;
  const shouldShowEmptyState = authStatus === "authenticated"
    && organizationsQuery.isSuccess
    && organizations.length === 0;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Organization"
        description="Organization profile, Team setup, and billing."
      />

      {statusMessage ? (
        <OrganizationNotice>{statusMessage}</OrganizationNotice>
      ) : null}

      {shouldShowSignInState ? (
        <OrganizationSection title="Organization" description="Organization access is tied to your signed-in account.">
          <SettingsCard>
            <div className="p-4 text-sm text-muted-foreground">
              Sign in to view your organization.
            </div>
          </SettingsCard>
        </OrganizationSection>
      ) : null}

      {shouldShowLoadingState ? (
        <div className="text-sm text-muted-foreground">Loading organizations...</div>
      ) : null}

      {shouldShowErrorState ? (
        <OrganizationSection title="Organization">
          <SettingsCard>
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Organization settings could not be loaded.
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void organizationsQuery.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          </SettingsCard>
        </OrganizationSection>
      ) : null}

      {shouldShowEmptyState ? (
        <OrganizationSection title="Team">
          <SettingsCard>
            {teamCheckoutQuery.data?.intent?.checkoutUrl ? (
              <SettingsCardRow
                label={teamCheckoutQuery.data.intent.teamName}
                description="Team checkout is pending. Continue checkout or cancel setup."
              >
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      void handleContinueTeamCheckout(teamCheckoutQuery.data!.intent!.checkoutUrl!);
                    }}
                  >
                    Continue checkout
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    loading={teamCheckoutActions.cancelingTeamCheckout}
                    onClick={() => {
                      void teamCheckoutActions.cancelTeamCheckout(teamCheckoutQuery.data!.intent!.id);
                    }}
                  >
                    Cancel setup
                  </Button>
                </div>
              </SettingsCardRow>
            ) : (
              <form onSubmit={(event) => { void handleCreateTeamCheckout(event); }}>
                <SettingsCardRow
                  label="Create a Team"
                  description="Choose a Team name, review what Team unlocks, then continue to checkout."
                >
                  <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:justify-end">
                    <Input
                      value={newTeamName}
                      onChange={(event) => setNewTeamName(event.currentTarget.value)}
                      placeholder="Team name"
                      aria-label="Team name"
                    />
                    <Button
                      type="submit"
                      loading={teamCheckoutActions.creatingTeamCheckout}
                      disabled={!newTeamName.trim()}
                    >
                      Create Team
                    </Button>
                  </div>
                </SettingsCardRow>
                {teamCheckoutActions.createTeamCheckoutError && !teamUpgradeGateOpen ? (
                  <div className="border-t border-border-light p-4 text-sm text-destructive">
                    {teamCheckoutActions.createTeamCheckoutError instanceof Error
                      ? teamCheckoutActions.createTeamCheckoutError.message
                      : "Team checkout could not start."}
                  </div>
                ) : null}
              </form>
            )}
          </SettingsCard>
        </OrganizationSection>
      ) : null}

      <UpgradeGateDialog
        open={teamUpgradeGateOpen}
        copy={TEAM_UPGRADE_GATE_COPY}
        contextLabel="Team"
        contextValue={newTeamName.trim()}
        loading={teamCheckoutActions.creatingTeamCheckout}
        error={
          teamCheckoutActions.createTeamCheckoutError instanceof Error
            ? teamCheckoutActions.createTeamCheckoutError.message
            : teamCheckoutActions.createTeamCheckoutError
              ? "Team checkout could not start."
              : null
        }
        onClose={() => setTeamUpgradeGateOpen(false)}
        onConfirm={() => {
          void confirmCreateTeamCheckout();
        }}
      />

      {activeOrganization ? (
        <>
          <OrganizationSettingsCard
            organization={activeOrganization}
            settingsName={settingsName}
            settingsLogoImage={settingsLogoImage}
            logoImageError={logoImageError}
            canManage
            saving={actions.updatingOrganization}
            onNameChange={setSettingsName}
            onLogoImageChange={setSettingsLogoImage}
            onLogoImageFile={handleLogoImageFile}
            onSubmit={handleUpdateOrganization}
          />

          <OrganizationBillingLinkSection />
        </>
      ) : null}
    </section>
  );
}

function OrganizationNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border-light bg-foreground/5 px-4 py-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
