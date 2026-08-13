import {
  useRef,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { CloudUpload } from "#product/primitives/icons/platform";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
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
        {/* Identity header */}
        <div className="flex items-center gap-3.5 px-3.5 py-[13px]">
          <OrganizationLogo organization={organization} logoImage={settingsLogoImage} />
          <div className="min-w-0 flex-1">
            <div className="text-body-emphasis font-medium text-foreground">{organization.name}</div>
            <div className="mt-px text-ui-sm text-muted-foreground">Organization</div>
          </div>
        </div>

        {/* Name row */}
        <div className="flex items-center gap-3.5 px-3.5 py-[13px]">
          <div className="min-w-0 flex-1">
            <div className="text-ui text-foreground">Name</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
          </div>
        </div>

        {/* Logo row */}
        <div className="flex flex-col gap-2 px-3.5 py-[13px] sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-ui text-foreground">Logo</div>
            <div className="mt-px text-ui-sm text-muted-foreground [text-wrap:pretty]">Square image for best results</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
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
            <div className="w-full text-ui text-destructive">{logoImageError}</div>
          ) : null}
        </div>
      </SettingsSection>
    </form>
  );
}
