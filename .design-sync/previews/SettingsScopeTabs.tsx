import { useState } from "react";
import { SettingsPageHeader, SettingsScopeTabs } from "@proliferate/ui";

const SCOPES = [
  { id: "user", label: "User" },
  { id: "org", label: "Org" },
  { id: "repo", label: "Repo" },
  { id: "agents", label: "Agents" },
];

function ScopeTabs({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <SettingsScopeTabs items={SCOPES} value={value} onChange={setValue} />;
}

export const Scopes = () => (
  <div className="w-[36rem]">
    <div className="flex h-10 items-stretch border-b border-border">
      <ScopeTabs initial="user" />
    </div>
  </div>
);

export const RepoSelected = () => (
  <div className="w-[36rem]">
    <div className="flex h-10 items-stretch border-b border-border">
      <ScopeTabs initial="repo" />
    </div>
  </div>
);

export const TwoScopes = () => (
  <div className="w-[36rem]">
    <div className="flex h-10 items-stretch border-b border-border">
      <SettingsScopeTabs
        items={[
          { id: "workspace", label: "Workspace" },
          { id: "personal", label: "Personal" },
        ]}
        value="workspace"
        onChange={() => {}}
      />
    </div>
  </div>
);

export const InPageHeader = () => (
  <div className="flex w-[36rem] flex-col gap-4">
    <SettingsPageHeader
      title="Settings"
      description="Scope determines who the change applies to."
    />
    <div className="flex h-10 items-stretch border-b border-border">
      <ScopeTabs initial="org" />
    </div>
  </div>
);
