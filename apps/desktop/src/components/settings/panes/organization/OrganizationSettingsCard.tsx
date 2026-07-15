import {
  useRef,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { CloudUpload } from "@proliferate/ui/icons";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
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
    <SettingsSection title="Profile">
      <form onSubmit={(event) => { void onSubmit(event); }}>
        <div className="overflow-clip rounded-lg bg-foreground/5">
          {/* Identity header */}
          <div className="flex min-h-[3.5rem] flex-col gap-3 border-b border-border-light px-3.5 py-3.5 text-sm sm:flex-row sm:items-center">
            <OrganizationLogo organization={organization} logoImage={settingsLogoImage} />
            <div className="min-w-0 flex-1">
              <div className="text-lg font-medium text-foreground">{organization.name}</div>
              <div className="text-muted-foreground">Organization</div>
            </div>
          </div>

          {/* Name row */}
          <div className="flex min-h-[3.5rem] flex-col gap-2 border-b border-border-light px-3.5 py-3.5 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium text-foreground">Name</div>
            </div>
            <div className="flex items-center gap-2">
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
          <div className="flex min-h-[3.5rem] flex-col gap-2 border-b border-border-light px-3.5 py-3.5 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium text-foreground">Logo</div>
              <div className="text-muted-foreground">Square image for best results</div>
            </div>
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
                    <CloudUpload className="size-4" />
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
              <div className="mt-1 w-full text-sm text-destructive">{logoImageError}</div>
            ) : null}
          </div>
        </div>
      </form>
    </SettingsSection>
  );
}
