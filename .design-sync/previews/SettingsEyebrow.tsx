import {
  Building2,
  CreditCard,
  Palette,
  SettingsEyebrow,
  SidebarNavRow,
  UsersRound,
} from "@proliferate/ui";

export const SectionHeadings = () => (
  <div className="flex w-full max-w-2xl flex-col gap-6">
    <div>
      <SettingsEyebrow>Environment</SettingsEyebrow>
      <p className="mt-1 text-ui-sm text-muted-foreground">
        Setup commands and container image used when a cloud sandbox boots.
      </p>
    </div>
    <div>
      <SettingsEyebrow>Secrets</SettingsEyebrow>
      <p className="mt-1 text-ui-sm text-muted-foreground">
        Environment variables and files mounted into every session.
      </p>
    </div>
    <div>
      <SettingsEyebrow>Danger zone</SettingsEyebrow>
      <p className="mt-1 text-ui-sm text-muted-foreground">
        Disconnect the repository and delete its cached worktrees.
      </p>
    </div>
  </div>
);

export const TableColumnHeaders = () => (
  <table className="w-full max-w-2xl text-left">
    <thead>
      <tr>
        <SettingsEyebrow as="th" className="border-b border-border px-3 pb-2 pt-3 text-left">
          Member
        </SettingsEyebrow>
        <SettingsEyebrow as="th" className="border-b border-border px-3 pb-2 pt-3 text-left">
          Harness
        </SettingsEyebrow>
        <SettingsEyebrow as="th" className="border-b border-border px-3 pb-2 pt-3 text-left">
          Surface
        </SettingsEyebrow>
        <SettingsEyebrow as="th" className="border-b border-border px-3 pb-2 pt-3 text-left">
          Route
        </SettingsEyebrow>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td className="px-3 py-2 text-ui text-foreground">pablo@proliferate.ai</td>
        <td className="px-3 py-2 text-ui text-foreground">Claude Code</td>
        <td className="px-3 py-2 text-ui text-muted-foreground">Cloud</td>
        <td className="px-3 py-2 font-mono text-ui-sm text-muted-foreground">org-default</td>
      </tr>
      <tr>
        <td className="px-3 py-2 text-ui text-foreground">dana@proliferate.ai</td>
        <td className="px-3 py-2 text-ui text-foreground">Codex</td>
        <td className="px-3 py-2 text-ui text-muted-foreground">Local</td>
        <td className="px-3 py-2 font-mono text-ui-sm text-muted-foreground">byo-key</td>
      </tr>
    </tbody>
  </table>
);

export const SidebarGroupHeading = () => (
  <div className="flex w-64 flex-col gap-1 rounded-lg bg-sidebar-background p-2">
    <SettingsEyebrow className="px-2 pb-1 pt-2">Organization</SettingsEyebrow>
    <SidebarNavRow icon={<Building2 />} label="Profile" active onPress={() => {}} />
    <SidebarNavRow icon={<UsersRound />} label="Members" onPress={() => {}} />
    <SidebarNavRow icon={<CreditCard />} label="Billing" onPress={() => {}} />
    <SettingsEyebrow className="px-2 pb-1 pt-4">Preferences</SettingsEyebrow>
    <SidebarNavRow icon={<Palette />} label="Appearance" onPress={() => {}} />
  </div>
);
