import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import type {
  SlackBotConfig,
  SlackRepoRoutingProfile,
  UpdateSlackBotConfigRequest,
  UpsertSlackRepoRoutingProfileRequest,
} from "@proliferate/cloud-sdk";

interface RepoRoutingSectionProps {
  config: SlackBotConfig | null;
  profiles: SlackRepoRoutingProfile[];
  loadingProfiles: boolean;
  canManage: boolean;
  saving: boolean;
  savingProfileId: string | null;
  onUpdateConfig: (body: UpdateSlackBotConfigRequest) => void;
  onUpdateProfile: (body: UpsertSlackRepoRoutingProfileRequest) => void;
}

export function RepoRoutingSection({
  config,
  profiles,
  loadingProfiles,
  canManage,
  saving,
  savingProfileId,
  onUpdateConfig,
  onUpdateProfile,
}: RepoRoutingSectionProps) {
  const repoMode = config?.repoMode ?? "auto";
  const fixedRepoId = config?.fixedCloudRepoConfigId ?? "";
  const allowedRepoIds = config?.allowedCloudRepoConfigIds ?? [];
  const allowedRepoSet = new Set(allowedRepoIds);
  const disabled = !canManage || !config || saving;

  return (
    <SettingsSection
      title="Repo routing"
      description="Decide whether Slack always targets one repo or uses the bounded repo router."
    >
        <SettingsRow
          label="Routing mode"
          description="Fixed mode pins every Slack mention to one repo. Auto mode routes across the allowlist."
        >
          <Select
            value={repoMode}
            disabled={disabled}
            aria-label="Slack repo routing mode"
            className="min-w-44"
            onChange={(event) => {
              const nextMode = event.currentTarget.value === "fixed" ? "fixed" : "auto";
              const nextFixedRepoId = fixedRepoId || profiles[0]?.cloudRepoConfigId || null;
              if (nextMode === "fixed" && !nextFixedRepoId) {
                return;
              }
              onUpdateConfig({
                repoMode: nextMode,
                fixedCloudRepoConfigId: nextMode === "fixed" ? nextFixedRepoId : null,
              });
            }}
          >
            <option value="auto">Auto</option>
            <option value="fixed">Fixed</option>
          </Select>
        </SettingsRow>

        {repoMode === "fixed" ? (
          <SettingsRow
            label="Fixed repo"
            description={loadingProfiles
              ? "Loading organization repos..."
              : "Slack mentions create sessions in this repo."}
          >
            <Select
              value={fixedRepoId}
              disabled={disabled || loadingProfiles || profiles.length === 0}
              aria-label="Slack fixed repo"
              className="min-w-64"
              onChange={(event) => {
                onUpdateConfig({
                  repoMode: "fixed",
                  fixedCloudRepoConfigId: event.currentTarget.value || null,
                });
              }}
            >
              <option value="">
                {profiles.length === 0 ? "No repos available" : "Choose a repo"}
              </option>
              {profiles.map((profile) => (
                <option key={profile.cloudRepoConfigId} value={profile.cloudRepoConfigId}>
                  {repoLabel(profile)}
                </option>
              ))}
            </Select>
          </SettingsRow>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            <div className="py-3">
              <div className="text-sm font-medium text-foreground">Auto router allowlist</div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {loadingProfiles
                  ? "Loading organization repos..."
                  : profiles.length === 0
                    ? "No organization repos are available for Slack routing yet."
                    : allowedRepoIds.length === 0
                      ? "Select at least one repo before enabling Slack auto routing."
                      : `${allowedRepoIds.length.toLocaleString()} repo${allowedRepoIds.length === 1 ? "" : "s"} allowed.`}
              </div>
            </div>
            {profiles.map((profile) => {
              const selected = allowedRepoSet.has(profile.cloudRepoConfigId);
              return (
                <div key={profile.id} className="space-y-3 py-3">
                  <Label className="mb-0 flex items-start gap-3">
                    <Checkbox
                      checked={selected}
                      disabled={disabled}
                      onChange={(event) => {
                        const nextIds = event.currentTarget.checked
                          ? [...allowedRepoIds, profile.cloudRepoConfigId]
                          : allowedRepoIds.filter((id) => id !== profile.cloudRepoConfigId);
                        onUpdateConfig({ allowedCloudRepoConfigIds: nextIds });
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {repoLabel(profile)}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {profile.languages.length > 0
                          ? profile.languages.join(", ")
                          : "No language metadata cached"}
                      </span>
                    </span>
                  </Label>
                  <Textarea
                    key={`${profile.id}:${profile.updatedAt}`}
                    defaultValue={profile.description ?? ""}
                    disabled={!canManage || savingProfileId === profile.id}
                    rows={2}
                    placeholder="Admin routing hint for this repo"
                    aria-label={`Routing description for ${repoLabel(profile)}`}
                    onBlur={(event) => {
                      const nextDescription = event.currentTarget.value.trim();
                      if (nextDescription === (profile.description ?? "")) {
                        return;
                      }
                      onUpdateProfile({
                        cloudRepoConfigId: profile.cloudRepoConfigId,
                        description: nextDescription || null,
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
    </SettingsSection>
  );
}

function repoLabel(profile: SlackRepoRoutingProfile): string {
  const repoName =
    profile.gitOwner && profile.gitRepoName
      ? `${profile.gitOwner}/${profile.gitRepoName}`
      : "Unknown repo";
  return profile.displayName || repoName;
}
