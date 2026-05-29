import {
  useRef,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { CloudUpload } from "@proliferate/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import {
  OrganizationLogo,
  OrganizationSection,
} from "@/components/settings/panes/organization/OrganizationLogo";
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
    <OrganizationSection
      title="Profile"
      description="Update how this organization appears in switchers, settings, and shared workspace context."
    >
      <SettingsCard>
        <form onSubmit={(event) => { void onSubmit(event); }}>
          <SettingsCardRow
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
              <div className="mt-2 text-xs text-destructive">{logoImageError}</div>
            ) : null}
          </SettingsCardRow>
          <SettingsCardRow
            label="Name"
            description="Shown anywhere organization context is displayed."
          >
            <Input
              value={settingsName}
              onChange={(event) => onNameChange(event.currentTarget.value)}
              aria-label="Organization name"
              disabled={!canManage}
              className="w-64 max-w-full"
            />
          </SettingsCardRow>
          {canManage ? (
            <div className="flex justify-end border-t border-border-light p-3">
              <Button type="submit" loading={saving} disabled={!settingsName.trim()}>
                Save
              </Button>
            </div>
          ) : null}
        </form>
      </SettingsCard>
    </OrganizationSection>
  );
}
