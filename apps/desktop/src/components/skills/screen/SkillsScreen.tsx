import type { ReactNode } from "react";
import type {
  InstalledSkill,
  LocalSkillAuditStatus,
  MarketplaceSkill,
  WorkspaceSkill,
} from "@anyharness/sdk";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { Spinner } from "@proliferate/ui/primitives/Spinner";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Tabs } from "@proliferate/ui/primitives/Tabs";
import { ExternalLink, Search, Trash } from "@proliferate/ui/icons";
import { useSkillsScreen, type SkillsTab } from "@/hooks/skills/facade/use-skills-screen";

const SKILL_TABS = [
  { id: "installed", label: "Installed" },
  { id: "marketplace", label: "Marketplace" },
] as const;

export function SkillsScreen() {
  const screen = useSkillsScreen();

  return (
    <ProductPageShell
      title="Skills"
      description="Install skills once into this machine, then enable them per workspace. Enabled skills are exposed to agents through Proliferate's local skills bridge on the next session start."
      maxWidthClassName="max-w-5xl"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            items={SKILL_TABS}
            activeId={screen.activeTab}
            onChange={(id) => screen.setActiveTab(id as SkillsTab)}
          />
          <div className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            {screen.selectedWorkspaceId ? "Workspace enablement active" : "Select a workspace to enable skills"}
          </div>
        </div>

        {screen.activeTab === "installed" ? (
          <InstalledSkillsView
            skills={screen.installedSkills}
            workspaceSkillsById={screen.workspaceSkillsById}
            selectedWorkspaceId={screen.selectedWorkspaceId}
            loading={screen.installedLoading}
            error={screen.installedError}
            deletingSkillId={screen.deletingSkillId}
            togglingSkillId={screen.togglingSkillId}
            onToggleWorkspaceSkill={screen.handleToggleWorkspaceSkill}
            onDeleteSkill={screen.handleDeleteSkill}
            onOpenSource={screen.openSource}
          />
        ) : (
          <MarketplaceSkillsView
            searchInput={screen.searchInput}
            searchQuery={screen.searchQuery}
            skills={screen.marketplaceSkills}
            loading={screen.marketplaceLoading}
            error={screen.marketplaceError}
            installingSkillId={screen.installingSkillId}
            onSearchInputChange={screen.setSearchInput}
            onSubmitSearch={screen.submitSearch}
            onInstall={screen.requestInstall}
            onOpenSource={screen.openSource}
          />
        )}
      </div>

      <ConfirmationDialog
        open={screen.pendingInstall !== null}
        title="Install unaudited skill?"
        description={auditConfirmationDescription(screen.pendingInstall)}
        confirmLabel="Install anyway"
        loading={screen.installing}
        onClose={() => screen.setPendingInstall(null)}
        onConfirm={() => {
          if (screen.pendingInstall) {
            void screen.installMarketplaceSkill(screen.pendingInstall);
          }
        }}
      />
    </ProductPageShell>
  );
}

function InstalledSkillsView({
  skills,
  workspaceSkillsById,
  selectedWorkspaceId,
  loading,
  error,
  deletingSkillId,
  togglingSkillId,
  onToggleWorkspaceSkill,
  onDeleteSkill,
  onOpenSource,
}: {
  skills: InstalledSkill[];
  workspaceSkillsById: Map<string, WorkspaceSkill>;
  selectedWorkspaceId: string | null;
  loading: boolean;
  error: Error | null;
  deletingSkillId?: string;
  togglingSkillId: string | null;
  onToggleWorkspaceSkill: (skill: InstalledSkill, enabled: boolean) => void;
  onDeleteSkill: (skill: InstalledSkill) => void;
  onOpenSource: (url: string | null | undefined) => void;
}) {
  if (loading) {
    return <LoadingState label="Loading installed skills..." />;
  }
  if (error) {
    return <ErrorState message={error.message} />;
  }
  if (skills.length === 0) {
    return (
      <EmptyState
        title="No local skills installed"
        description="Search the marketplace to install a skill into this machine's local Proliferate skill library."
      />
    );
  }

  return (
    <div className="grid gap-3">
      {skills.map((skill) => {
        const workspaceSkill = workspaceSkillsById.get(skill.skillId);
        const enabled = workspaceSkill?.enabled ?? false;
        return (
          <SkillCard
            key={skill.skillId}
            skill={skill}
            trailing={(
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-full border border-border bg-background px-2 py-1">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Enabled
                  </span>
                  <Switch
                    size="compact"
                    checked={enabled}
                    disabled={!selectedWorkspaceId || togglingSkillId === skill.skillId}
                    onChange={(next) => onToggleWorkspaceSkill(skill, next)}
                  />
                </div>
                {skill.sourceUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title="Open skill source"
                    onClick={() => onOpenSource(skill.sourceUrl)}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Uninstall skill"
                  loading={deletingSkillId === skill.skillId}
                  onClick={() => onDeleteSkill(skill)}
                >
                  <Trash className="size-3.5" />
                </Button>
              </div>
            )}
          />
        );
      })}
    </div>
  );
}

function MarketplaceSkillsView({
  searchInput,
  searchQuery,
  skills,
  loading,
  error,
  installingSkillId,
  onSearchInputChange,
  onSubmitSearch,
  onInstall,
  onOpenSource,
}: {
  searchInput: string;
  searchQuery: string;
  skills: MarketplaceSkill[];
  loading: boolean;
  error: Error | null;
  installingSkillId: string | null;
  onSearchInputChange: (value: string) => void;
  onSubmitSearch: () => void;
  onInstall: (skill: MarketplaceSkill) => void;
  onOpenSource: (url: string | null | undefined) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitSearch();
        }}
      >
        <Input
          value={searchInput}
          placeholder="Search skills.sh, for example: code review, playwright, docs"
          onChange={(event) => onSearchInputChange(event.currentTarget.value)}
        />
        <Button type="submit" variant="primary" className="shrink-0">
          <Search className="size-3.5" />
          Search
        </Button>
      </form>

      {!searchQuery ? (
        <EmptyState
          title="Search the skills.sh marketplace"
          description="Marketplace lookup requires a skills.sh-compatible bearer token in SKILLS_SH_AUTH_TOKEN or VERCEL_OIDC_TOKEN."
        />
      ) : loading ? (
        <LoadingState label="Searching marketplace..." />
      ) : error ? (
        <ErrorState message={error.message} />
      ) : skills.length === 0 ? (
        <EmptyState
          title="No matching skills"
          description="Try a broader search term or check marketplace token configuration."
        />
      ) : (
        <div className="grid gap-3">
          {skills.map((skill) => (
            <SkillCard
              key={skill.skillId}
              skill={marketplaceSkillToInstalledView(skill)}
              trailing={(
                <div className="flex items-center gap-2">
                  {skill.sourceUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Open skill source"
                      onClick={() => onOpenSource(skill.sourceUrl)}
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant={skill.installed ? "secondary" : "primary"}
                    disabled={skill.installed || skill.auditStatus === "fail"}
                    loading={installingSkillId === skill.skillId}
                    onClick={() => onInstall(skill)}
                  >
                    {installLabel(skill)}
                  </Button>
                </div>
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SkillCard({
  skill,
  trailing,
}: {
  skill: InstalledSkill;
  trailing: ReactNode;
}) {
  const files = skill.files ?? [];
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {skill.displayName}
            </h3>
            <AuditBadge status={skill.auditStatus} />
            <Badge tone="neutral">{files.length} files</Badge>
            {skill.installCount > 0 ? (
              <Badge tone="info">{skill.installCount.toLocaleString()} installs</Badge>
            ) : null}
          </div>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            {skill.description || "No description provided."}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-accent px-2 py-0.5 font-mono">
              {skill.skillId}
            </span>
            {skill.source ? <span>{skill.source}</span> : null}
          </div>
          {files.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {files.slice(0, 6).map((file) => (
                <span
                  key={file.path}
                  className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground"
                >
                  {file.path}
                </span>
              ))}
              {files.length > 6 ? (
                <span className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                  +{files.length - 6} more
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          {trailing}
        </div>
      </div>
    </article>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[18rem] items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 text-sm text-muted-foreground">
      <Spinner className="mr-2 size-4" />
      {label}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {description}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      {message}
    </div>
  );
}

function AuditBadge({ status }: { status: LocalSkillAuditStatus }) {
  return <Badge tone={auditTone(status)}>{auditLabel(status)}</Badge>;
}

function auditTone(status: LocalSkillAuditStatus): BadgeTone {
  switch (status) {
    case "pass":
      return "success";
    case "warn":
      return "warning";
    case "fail":
      return "destructive";
    case "missing":
      return "neutral";
  }
}

function auditLabel(status: LocalSkillAuditStatus): string {
  switch (status) {
    case "pass":
      return "audit passed";
    case "warn":
      return "audit warning";
    case "fail":
      return "audit failed";
    case "missing":
      return "audit missing";
  }
}

function auditConfirmationDescription(skill: MarketplaceSkill | null): string {
  if (!skill) {
    return "";
  }
  if (skill.auditStatus === "warn") {
    return `${skill.name} has warnings from skills.sh audits. Install only if you trust the source and reviewed the files.`;
  }
  return `${skill.name} does not have a skills.sh audit result. Install only if you trust the source and reviewed the files.`;
}

function installLabel(skill: MarketplaceSkill): string {
  if (skill.installed) {
    return "Installed";
  }
  if (skill.auditStatus === "warn" || skill.auditStatus === "missing") {
    return "Review install";
  }
  return "Install";
}

function marketplaceSkillToInstalledView(skill: MarketplaceSkill): InstalledSkill {
  return {
    skillId: skill.skillId,
    sourceKind: "skills_sh",
    source: skill.source,
    slug: skill.slug,
    displayName: skill.name,
    description: skill.description,
    installUrl: skill.installUrl,
    sourceUrl: skill.sourceUrl,
    hash: skill.hash,
    installCount: skill.installCount,
    auditStatus: skill.auditStatus,
    audits: skill.audits ?? [],
    files: skill.files ?? [],
    installedAt: "",
    updatedAt: "",
  };
}
