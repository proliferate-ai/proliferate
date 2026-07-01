import {
  useRef,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { CloudUpload } from "@proliferate/ui/icons";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { OrganizationLogo } from "@/components/settings/panes/organization/OrganizationLogo";
import type { OrganizationRecord } from "@/lib/domain/organizations/organization-records";

const ORGANIZATION_SETTINGS_HELPER_CLASS = "font-normal text-muted-foreground/70";

export function OrganizationSettingsCard({
  organization,
  settingsName,
  settingsLogoImage,
  logoImageError,
  canManage,
  saving,
  onNameChange,
  onLogoImageChange,
  onLogoImageFile,
  onSubmit,
}: {
  organization: OrganizationRecord;
  settingsName: string;
  settingsLogoImage: string | null;
  logoImageError: string | null;
  canManage: boolean;
  saving: boolean;
  onNameChange: (value: string) => void;
  onLogoImageChange: (value: string | null) => void;
  onLogoImageFile: (file: File | null) => Promise<void>;
  onSubmit: (event: FormEvent) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    await onLogoImageFile(event.currentTarget.files?.[0] ?? null);
    event.currentTarget.value = "";
  }

  return (
    <SettingsSection
      title="Organization settings"
      description="Manage the organization name and logo used in switchers, settings, and shared workspaces."
    >
      <form onSubmit={(event) => { void onSubmit(event); }}>
        <SettingsRow
          label="Logo"
          description={(
            <span className={ORGANIZATION_SETTINGS_HELPER_CLASS}>
              Upload a square image for the clearest result.
            </span>
          )}
        >
            <div className="flex flex-wrap items-center justify-end gap-2">
              <OrganizationLogo organization={organization} logoImage={settingsLogoImage} />
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => { void handleFileChange(event); }}
              />
              {canManage ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <CloudUpload className="size-4" />
                    Upload
                  </Button>
                  {settingsLogoImage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        onLogoImageChange(null);
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
            {logoImageError ? (
              <div className="mt-2 text-xs text-destructive">{logoImageError}</div>
            ) : null}
          </SettingsRow>
          <SettingsRow
            label="Organization name"
            description={(
              <span className={ORGANIZATION_SETTINGS_HELPER_CLASS}>
                Shown anywhere organization context is displayed.
              </span>
            )}
          >
            <Input
              value={settingsName}
              onChange={(event) => onNameChange(event.currentTarget.value)}
              aria-label="Organization name"
              disabled={!canManage}
              className="w-64 max-w-full"
            />
          </SettingsRow>
          {canManage ? (
            <div className="flex justify-end border-t border-border p-3">
              <Button type="submit" loading={saving} disabled={!settingsName.trim()}>
                Save
              </Button>
            </div>
          ) : null}
        </form>
    </SettingsSection>
  );
}
