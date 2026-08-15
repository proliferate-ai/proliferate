import {
  useRef,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { CloudUpload } from "#product/primitives/icons/platform";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { OrganizationLogo } from "#product/components/settings/panes/organization/OrganizationLogo";
import type { OrganizationRecord } from "#product/lib/domain/organizations/organization-records";

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
    <form onSubmit={(event) => { void onSubmit(event); }}>
      <SettingsSection title="Profile">
        <RosterRow
          density="comfortable"
          leading={<OrganizationLogo organization={organization} logoImage={settingsLogoImage} />}
          title={organization.name}
          secondary="Organization"
        />

        <SettingsRow label="Name">
          <Input
            value={settingsName}
            onChange={(event) => onNameChange(event.currentTarget.value)}
            aria-label="Organization name"
            disabled={!canManage}
            className="w-64 max-w-full"
          />
          {canManage ? (
            <Button type="submit" size="sm" loading={saving} disabled={!settingsName.trim()}>
              Save
            </Button>
          ) : null}
        </SettingsRow>

        <SettingsRow label="Logo" description="Square image for best results">
          {/* Column layout, not SettingsRow's default row: the upload
              controls and any submit error stack vertically in the trailing
              slot rather than spanning the row's full width like the
              original hand-roll — a documented shape difference from
              adopting SettingsRow's single trailing slot. */}
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
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
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <CloudUpload className="icon-paired" />
                    Upload
                  </Button>
                  {settingsLogoImage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
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
              <div className="text-ui text-destructive">{logoImageError}</div>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsSection>
    </form>
  );
}
