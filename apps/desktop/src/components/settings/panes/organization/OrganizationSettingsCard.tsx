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
      title="Profile"
      description="Name and logo shown in switchers and shared workspaces"
    >
      <form onSubmit={(event) => { void onSubmit(event); }}>
        <SettingsRow
          label="Logo"
          description="Upload a square image for the clearest result."
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
              <div className="mt-2 text-ui-sm text-destructive">{logoImageError}</div>
            ) : null}
          </SettingsRow>
          <SettingsRow label="Organization name">
            <div className="flex items-center gap-2">
              <Input
                value={settingsName}
                onChange={(event) => onNameChange(event.currentTarget.value)}
                aria-label="Organization name"
                disabled={!canManage}
                className="w-64 max-w-full"
              />
              {canManage ? (
                <Button type="submit" loading={saving} disabled={!settingsName.trim()}>
                  Save
                </Button>
              ) : null}
            </div>
          </SettingsRow>
        </form>
    </SettingsSection>
  );
}
