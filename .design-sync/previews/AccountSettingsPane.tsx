import { AccountSettingsPane } from "@proliferate/ui";

const noop = () => {};

const GITHUB_CONNECTED = {
  provider: "github",
  label: "GitHub",
  accountLabel: "@pablo-hansen",
  connected: true,
  status: "ready",
  primary: true,
};

const GOOGLE_CONNECTED = {
  provider: "google",
  label: "Google",
  accountLabel: "pablo@proliferate.ai",
  connected: true,
  status: "ready",
};

export const SignedIn = () => (
  <div className="w-full max-w-3xl">
    <AccountSettingsPane
      displayName="Pablo Hansen"
      email="pablo@proliferate.ai"
      avatarUrl={null}
      profileSummary="Signed in to Proliferate Cloud. Desktop, web, and mobile share this account."
      githubLabel="@pablo-hansen"
      providers={[GITHUB_CONNECTED, GOOGLE_CONNECTED]}
      actions={{
        signOut: { label: "Sign out", onClick: noop },
      }}
      passwordCredential={{
        enabled: true,
        setAt: "2026-05-14T09:12:00.000Z",
        onSubmit: noop,
      }}
    />
  </div>
);

export const GitHubNeedsReconnect = () => (
  <div className="w-full max-w-3xl">
    <AccountSettingsPane
      displayName="Pablo Hansen"
      email="pablo@proliferate.ai"
      avatarUrl={null}
      profileSummary="GitHub access expired. Reconnect to keep cloud environments building."
      githubLabel="@pablo-hansen"
      providers={[
        {
          provider: "github",
          label: "GitHub",
          accountLabel: "@pablo-hansen",
          connected: true,
          status: "needs_reauth",
        },
      ]}
      actions={{
        reconnectGitHub: { label: "Reconnect GitHub", onClick: noop },
        connectGoogle: { label: "Connect", onClick: noop },
      }}
      error="GitHub authorization expired 2 days ago."
    />
  </div>
);

export const WithConnectedServices = () => (
  <div className="w-full max-w-3xl">
    <AccountSettingsPane
      displayName="Pablo Hansen"
      email="pablo@proliferate.ai"
      avatarUrl={null}
      profileSummary="Signed in to Proliferate Cloud."
      githubLabel="@pablo-hansen"
      providers={[GITHUB_CONNECTED]}
      actions={{}}
      connectedServices={[
        {
          id: "github-app",
          label: "GitHub App",
          description:
            "Lets cloud sandboxes clone proliferate-ai/proliferate and push branches on your behalf.",
          accountLabel: "proliferate-ai",
          statusLabel: "Authorized",
          tone: "success",
          action: { label: "Manage", onClick: noop },
        },
        {
          id: "linear",
          label: "Linear",
          description: "Read issue context when an agent starts work from a Linear ticket.",
          accountLabel: "Not connected",
          statusLabel: "Not connected",
          tone: "neutral",
          action: { label: "Connect", onClick: noop },
        },
      ]}
    />
  </div>
);
