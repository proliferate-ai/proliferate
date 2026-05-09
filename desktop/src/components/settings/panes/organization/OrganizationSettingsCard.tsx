import {
  useRef,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { CloudUpload } from "@/components/ui/workspace-icons";
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
    <OrganizationSection title="Organization Settings">
      <SettingsCard>
        <form onSubmit={(event) => { void onSubmit(event); }}>
          <SettingsCardRow
            label="Organization image"
            description="Used in the organization switcher and settings."
          >
            <div className="flex items-center gap-2">
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
            label="Organization name"
            description="Shown in the organization switcher and settings."
          >
            <Input
              value={settingsName}
              onChange={(event) => onNameChange(event.currentTarget.value)}
              aria-label="Organization name"
              disabled={!canManage}
              className="w-64"
            />
          </SettingsCardRow>
          {canManage ? (
            <div className="flex justify-end p-3">
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
