/**
 * Mobile UI Flow Handoff
 *
 * Reference-only condensed TSX. This file is not imported by the app.
 *
 * Purpose:
 * - Give an agent without repo access one place to understand the current
 *   Proliferate Mobile product flow.
 * - Preserve the important UI structure, route model, cloud hooks, and actions.
 * - Omit most styling/detail components so the product behavior is easier to see.
 *
 * Current product shape:
 * - Mobile is a cloud-mediated client.
 * - It does not talk directly to AnyHarness.
 * - Main jobs: create personal cloud work, open projected sessions, claim shared
 *   work, reply to sessions, create/pause personal automations, show account
 *   readiness.
 * - It is not currently a full team admin console, plugin config UI, shared
 *   sandbox config UI, or desktop replacement.
 *
 * Source map in the real codebase:
 * - mobile/src/App.tsx
 * - mobile/src/providers/MobileAuthProvider.tsx
 * - mobile/src/providers/MobileCloudProvider.tsx
 * - mobile/src/components/shell/MobileShell.tsx
 * - mobile/src/navigation/navigation-model.ts
 * - mobile/src/components/home/MobileHomeScreen.tsx
 * - mobile/src/components/workspaces/MobileWorkspacesScreen.tsx
 * - mobile/src/components/sessions/MobileSessionsScreen.tsx
 * - mobile/src/components/chat/MobileChatScreen.tsx
 * - mobile/src/components/automations/MobileAutomationsScreen.tsx
 * - mobile/src/components/settings/MobileSettingsScreen.tsx
 * - mobile/src/lib/access/cloud/pending-mobile-prompt-store.ts
 * - mobile/src/lib/access/cloud/pending-mobile-prompt-dispatch.ts
 */

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

/**
 * These names mirror the real Cloud SDK hooks used by Mobile today.
 * This file is a handoff artifact, so the imports are intentionally described
 * instead of resolved.
 */
type AuthProviderName = "github" | "apple" | "google";
type AuthState = "bootstrapping" | "signed_out" | "needs_github" | "active";

type CloudWorkspaceSummary = {
  id: string;
  displayName: string | null;
  repo: { owner: string; name: string; branch?: string | null; baseBranch?: string | null };
  visibility: "private" | "shared_unclaimed" | "claimed" | "archived" | string;
  status: string;
  workspaceStatus?: string | null;
  exposureState?: string | null;
  targetId?: string | null;
  anyharnessWorkspaceId?: string | null;
  lastSessionSummary?: {
    targetId: string;
    workspaceId?: string | null;
    sessionId: string;
    title?: string | null;
    status: string;
    lastEventAt?: string | null;
  } | null;
};

type CloudWorkspaceDetail = CloudWorkspaceSummary & {
  readyAgentKinds?: string[] | null;
  allowedAgentKinds?: string[] | null;
  actionBlockReason?: string | null;
};

type CloudSessionProjection = {
  targetId: string;
  cloudWorkspaceId?: string | null;
  workspaceId?: string | null;
  sessionId: string;
  title?: string | null;
  status: string;
  liveConfig?: unknown;
  lastEventSeq?: number | null;
  lastEventAt?: string | null;
  startedAt?: string | null;
};

type AutomationResponse = {
  id: string;
  title: string;
  enabled: boolean;
  gitOwner: string;
  gitRepoName: string;
  schedule: { summary: string };
};

type CloudAgentRunConfig = {
  id: string;
  name: string;
  agentKind: string;
  modelId?: string | null;
  resolved?: { modelId?: string | null } | null;
  status: string;
  usableInPersonalSandboxes: boolean;
};

type MobileRouteId = "home" | "workspaces" | "sessions" | "automations" | "settings";

type MobileCloudChat = {
  workspaceId: string;
  workspaceName: string;
  repoLabel: string;
  branchLabel: string;
  targetId: string | null;
  workspaceRuntimeId: string | null;
  sessionId: string | null;
  title: string;
  status: string;
  visibility: string;
  initialPendingPrompt?: MobilePendingPrompt | null;
};

type MobilePendingPrompt = {
  id: string;
  text: string;
  modelId: string | null;
  modeId: string | null;
  createdAt: number;
  dispatchedSessionId?: string | null;
  failedAt?: number | null;
  failureMessage?: string | null;
};

const ROUTES: Array<{ id: MobileRouteId; label: string }> = [
  { id: "home", label: "Home" },
  { id: "workspaces", label: "Workspaces" },
  { id: "sessions", label: "Sessions" },
  { id: "automations", label: "Automations" },
  { id: "settings", label: "Settings" },
];

/**
 * App composition in production:
 *
 * <SafeAreaProvider>
 *   <MobileAuthProvider>
 *     <MobileTelemetryProvider>
 *       <MobileCloudProvider>
 *         <MobileShell />
 *       </MobileCloudProvider>
 *     </MobileTelemetryProvider>
 *   </MobileAuthProvider>
 * </SafeAreaProvider>
 */
export function MobileShellHandoff() {
  const auth = useMobileAuth();
  const [route, setRoute] = useState<MobileRouteId>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedChat, setSelectedChat] = useState<MobileCloudChat | null>(null);

  // Real app also:
  // - handles universal/deep links for /workspaces/:id and /sessions/:id
  // - restores last route/chat from storage per user
  // - records screen telemetry
  // - implements Android back behavior

  if (auth.authState === "bootstrapping") {
    return <Centered title="Opening Proliferate" />;
  }

  if (auth.authState === "signed_out") {
    return (
      <MobileAuthScreen
        loadingAction={auth.loadingAction}
        error={auth.error}
        onProvider={(provider) => void auth.signInWithProvider(provider)}
      />
    );
  }

  if (auth.authState === "needs_github") {
    return (
      <MobileConnectGitHubScreen
        loading={auth.loadingAction === "github_link"}
        error={auth.error}
        onConnect={() => void auth.connectGitHub()}
        onSignOut={() => void auth.signOut()}
      />
    );
  }

  if (selectedChat) {
    return (
      <MobileChatScreen
        chat={selectedChat}
        ownerUserId={auth.user?.id ?? null}
        onBack={() => setSelectedChat(null)}
        onSessionSelected={(sessionId) => {
          setSelectedChat((current) => current ? { ...current, sessionId } : current);
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <TopBar
        title={routeLabel(route)}
        subtitle={routeSubtitle(route)}
        leading="menu"
        onLeadingPress={() => setDrawerOpen(true)}
      />

      {route === "home" ? (
        <MobileHomeScreen
          ownerUserId={auth.user?.id ?? null}
          onOpenChat={setSelectedChat}
        />
      ) : route === "workspaces" ? (
        <MobileWorkspacesScreen onOpenChat={setSelectedChat} />
      ) : route === "sessions" ? (
        <MobileSessionsScreen onOpenChat={setSelectedChat} />
      ) : route === "automations" ? (
        <MobileAutomationsScreen />
      ) : (
        <MobileSettingsScreen onSignOut={() => void auth.signOut()} />
      )}

      {route !== "home" ? (
        <FloatingButton label="New chat" onPress={() => setRoute("home")} />
      ) : null}

      {drawerOpen ? (
        <MobileDrawer
          activeRoute={route}
          onNavigate={(next) => {
            setRoute(next);
            setDrawerOpen(false);
          }}
          onClose={() => setDrawerOpen(false)}
          onSignOut={() => void auth.signOut()}
        />
      ) : null}
    </View>
  );
}

function MobileAuthScreen(props: {
  loadingAction: AuthProviderName | "github_link" | null;
  error: string | null;
  onProvider: (provider: AuthProviderName) => void;
}) {
  return (
    <Screen>
      <Centered
        title="Proliferate"
        body="Run and orchestrate coding agents. Sign in to get started."
      />
      <Button label="Continue with GitHub" onPress={() => props.onProvider("github")} />
      <Button label="Continue with Apple" onPress={() => props.onProvider("apple")} />
      <Button label="Continue with Google" onPress={() => props.onProvider("google")} />
      <Caption>
        GitHub is required for cloud workspaces and automations. You can link it after
        signing in with Apple or Google.
      </Caption>
      {props.error ? <ErrorText>{props.error}</ErrorText> : null}
    </Screen>
  );
}

function MobileConnectGitHubScreen(props: {
  loading: boolean;
  error: string | null;
  onConnect: () => void;
  onSignOut: () => void;
}) {
  return (
    <Screen>
      <Centered
        title="Connect GitHub"
        body="Linking GitHub gives agents access to read and modify your repos."
      />
      <Button label={props.loading ? "Connecting..." : "Continue with GitHub"} onPress={props.onConnect} />
      <Button label="Sign out" onPress={props.onSignOut} secondary />
      {props.error ? <ErrorText>{props.error}</ErrorText> : null}
    </Screen>
  );
}

function MobileHomeScreen(props: {
  ownerUserId: string | null;
  onOpenChat: (chat: MobileCloudChat) => void;
}) {
  const [draft, setDraft] = useState("");
  const [repoId, setRepoId] = useState("");
  const [modelId, setModelId] = useState("gpt-5.4");
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const repoConfigs = useCloudRepoConfigs();
  const createWorkspace = useCreateCloudWorkspace();

  const repoOptions = useMemo(
    () => (repoConfigs.data?.configs ?? [])
      .filter((repo) => repo.configured)
      .map((repo) => ({
        id: `${repo.gitOwner}/${repo.gitRepoName}`,
        gitOwner: repo.gitOwner,
        gitRepoName: repo.gitRepoName,
        label: `${repo.gitOwner}/${repo.gitRepoName}`,
      })),
    [repoConfigs.data?.configs],
  );
  const selectedRepo = repoOptions.find((repo) => repo.id === repoId) ?? repoOptions[0] ?? null;

  async function submitPrompt() {
    const text = draft.trim();
    if (!text || !selectedRepo || submitInFlightRef.current) return;
    if (!props.ownerUserId) {
      setError("Account is still loading. Try again in a moment.");
      return;
    }

    submitInFlightRef.current = true;
    const pendingPrompt: MobilePendingPrompt = {
      id: `mobile-home:${Date.now().toString(36)}`,
      text,
      modelId,
      modeId: null,
      createdAt: Date.now(),
    };

    try {
      const workspace = await createWorkspace.mutateAsync({
        gitProvider: "github",
        gitOwner: selectedRepo.gitOwner,
        gitRepoName: selectedRepo.gitRepoName,
        branchName: buildMobileBranchName(text),
        displayName: buildMobileDisplayName(text),
        ownerScope: "personal",
      });

      await savePendingMobilePrompt(workspace.id, props.ownerUserId, pendingPrompt)
        .catch(() => undefined);

      setDraft("");
      props.onOpenChat(chatFromWorkspace(workspace, pendingPrompt));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create workspace.");
    } finally {
      submitInFlightRef.current = false;
    }
  }

  return (
    <Screen title="What should we run?" subtitle="Choose a repository and send the first prompt.">
      <Section title="Repository">
        {repoConfigs.isLoading ? (
          <Caption>Loading configured repositories...</Caption>
        ) : repoOptions.length === 0 ? (
          <Caption>No configured cloud repositories are available for mobile.</Caption>
        ) : (
          repoOptions.map((repo) => (
            <ChoiceRow
              key={repo.id}
              label={repo.label}
              selected={repo.id === selectedRepo?.id}
              onPress={() => setRepoId(repo.id)}
            />
          ))
        )}
      </Section>

      <Section title="Model">
        {["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"].map((model) => (
          <ChoiceRow
            key={model}
            label={model}
            selected={modelId === model}
            onPress={() => setModelId(model)}
          />
        ))}
      </Section>

      <Section title="Prompt">
        <TextInput value={draft} onChangeText={setDraft} multiline placeholder="Ask Proliferate to work in this repo..." />
        <Button label="Start cloud chat" onPress={() => void submitPrompt()} />
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Section>
    </Screen>
  );
}

function MobileWorkspacesScreen(props: { onOpenChat: (chat: MobileCloudChat) => void }) {
  // Current behavior: scope "my". This misses a pure unclaimed/team inbox view.
  // Future likely behavior: scope "exposed" or separate sections for Mine/Claimable.
  const workspaces = useCloudWorkspaces({ scope: "my" });
  const rows = workspaces.data ?? [];
  const shared = rows.filter((workspace) => workspace.visibility !== "private");
  const personal = rows.filter((workspace) => workspace.visibility === "private");

  return (
    <Screen>
      {workspaces.isLoading ? (
        <Centered title="Loading workspaces" body="Fetching cloud workspaces." />
      ) : rows.length === 0 ? (
        <Centered title="No cloud workspaces yet" body="Continue a workspace remotely from Desktop to see it here." />
      ) : (
        <>
          <WorkspaceSection title="Shared" rows={shared} onOpenChat={props.onOpenChat} />
          <WorkspaceSection title="Personal" rows={personal} onOpenChat={props.onOpenChat} />
        </>
      )}
    </Screen>
  );
}

function WorkspaceSection(props: {
  title: string;
  rows: CloudWorkspaceSummary[];
  onOpenChat: (chat: MobileCloudChat) => void;
}) {
  if (props.rows.length === 0) return null;
  return (
    <Section title={`${props.title} (${props.rows.length})`}>
      {props.rows.map((workspace) => (
        <ListRow
          key={workspace.id}
          title={workspace.displayName ?? workspace.repo.name}
          subtitle={`${workspace.repo.owner}/${workspace.repo.name} - ${workspace.repo.branch ?? workspace.repo.baseBranch ?? "main"}`}
          meta={workspace.visibility === "shared_unclaimed" ? "Claim" : workspace.lastSessionSummary?.title ?? workspace.exposureState ?? workspace.status}
          onPress={() => props.onOpenChat(chatFromWorkspace(workspace))}
        />
      ))}
    </Section>
  );
}

function MobileSessionsScreen(props: { onOpenChat: (chat: MobileCloudChat) => void }) {
  const workspaces = useCloudWorkspaces({ scope: "my" });
  const rows = workspaces.data ?? [];
  const projectedCount = rows.reduce((count, row) => count + (row.lastSessionSummary ? 1 : 0), 0);

  return (
    <Screen>
      {workspaces.isLoading ? (
        <Centered title="Loading sessions" body="Fetching projected cloud sessions." />
      ) : projectedCount === 0 ? (
        <Centered title="No projected sessions" body="Cloud sessions appear here after a workspace has live projection." />
      ) : (
        rows.map((workspace) => (
          <MobileWorkspaceSessionRows
            key={workspace.id}
            workspace={workspace}
            onOpenChat={props.onOpenChat}
          />
        ))
      )}
    </Screen>
  );
}

function MobileWorkspaceSessionRows(props: {
  workspace: CloudWorkspaceSummary;
  onOpenChat: (chat: MobileCloudChat) => void;
}) {
  const snapshot = useCloudWorkspaceSnapshot(props.workspace.id, Boolean(props.workspace.lastSessionSummary));
  const sessions = snapshot.data?.sessions.length
    ? [...snapshot.data.sessions].sort(compareSessionRecency)
    : props.workspace.lastSessionSummary
      ? [sessionFromSummary(props.workspace)]
      : [];

  return (
    <>
      {sessions.map((session) => (
        <ListRow
          key={`${props.workspace.id}:${session.sessionId}`}
          title={session.title ?? props.workspace.displayName ?? props.workspace.repo.name}
          subtitle={`${props.workspace.displayName ?? props.workspace.repo.name} - ${session.sessionId.slice(0, 8)}`}
          meta={props.workspace.visibility === "shared_unclaimed" ? "Claim" : session.status}
          onPress={() => props.onOpenChat(chatFromSession(props.workspace, session))}
        />
      ))}
    </>
  );
}

function MobileChatScreen(props: {
  chat: MobileCloudChat;
  ownerUserId: string | null;
  onBack: () => void;
  onSessionSelected?: (sessionId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(props.chat.sessionId);
  const [newSessionMode, setNewSessionMode] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<MobilePendingPrompt | null>(null);
  const [pendingPromptStatus, setPendingPromptStatus] = useState<string | null>(null);
  const [pendingPromptFailed, setPendingPromptFailed] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [claimedLocally, setClaimedLocally] = useState(false);
  const dispatchingRef = useRef(false);

  const client = useCloudClient();
  const workspaceQuery = useCloudWorkspaceSnapshot(props.chat.workspaceId, true);
  const workspaceLive = useWorkspaceLive(props.chat.workspaceId, { enabled: true });
  const snapshot = workspaceLive.snapshot ?? workspaceQuery.data;
  const workspace: CloudWorkspaceDetail | null = snapshot?.workspace ?? null;
  const sessions: CloudSessionProjection[] = useMemo(
    () => [...(snapshot?.sessions ?? [])].sort(compareSessionRecency),
    [snapshot?.sessions],
  );

  const selectedSession = selectedSessionId
    ? sessions.find((session) => session.sessionId === selectedSessionId) ?? null
    : sessions[0] ?? null;
  const session = newSessionMode ? null : selectedSession;
  const targetId = session?.targetId ?? workspace?.targetId ?? props.chat.targetId;

  const sessionLive = useSessionLive(session?.sessionId ?? null, {
    targetId,
    enabled: Boolean(session && targetId),
  });
  const transcriptSnapshot = useCloudTranscriptSnapshot(targetId, session?.sessionId ?? null, Boolean(session && targetId));
  const sessionEvents = useCloudSessionEvents(targetId, session?.sessionId ?? null, Boolean(session && targetId));

  const transcriptRows = buildCloudTranscriptRows({
    sessionId: session?.sessionId ?? null,
    events: sessionEvents.data?.events ?? [],
    fallbackItems: sessionLive.snapshot?.transcriptItems ?? transcriptSnapshot.data?.transcriptItems ?? [],
    pendingInteractions: sessionLive.snapshot?.pendingInteractions ?? transcriptSnapshot.data?.pendingInteractions ?? [],
    pendingPrompt,
    pendingPromptStatus,
    pendingPromptFailed,
  });

  const enqueueStartSession = useEnqueueCloudCommand();
  const enqueuePrompt = useEnqueueCloudCommand();
  const enqueueConfig = useEnqueueCloudCommand();
  const claimWorkspace = useClaimCloudWorkspace();

  const isUnclaimed = workspace?.visibility === "shared_unclaimed" && !claimedLocally;
  const workspaceReady =
    (workspace?.workspaceStatus ?? workspace?.status) === "ready"
    && Boolean(workspace?.targetId)
    && Boolean(workspace?.anyharnessWorkspaceId);
  const canSubmit = Boolean(draft.trim() && !isUnclaimed && (session || workspaceReady));

  useEffect(() => {
    setSelectedSessionId(props.chat.sessionId);
    setDraft("");
    setNewSessionMode(false);
    setPendingPromptStatus(null);
    setPendingPromptFailed(false);
    setClaimedLocally(false);
  }, [props.chat.workspaceId, props.chat.sessionId]);

  useEffect(() => {
    if (!props.ownerUserId) return;
    let active = true;
    void loadPendingMobilePrompt(props.chat.workspaceId, props.ownerUserId).then((stored) => {
      if (!active) return;
      const restored = stored ?? props.chat.initialPendingPrompt ?? null;
      setPendingPrompt(restored);
      setPendingPromptFailed(Boolean(restored?.failedAt));
      setPendingPromptStatus(restored?.failureMessage ?? null);
      if (restored?.dispatchedSessionId) {
        setSelectedSessionId(restored.dispatchedSessionId);
        setNewSessionMode(false);
      } else if (restored) {
        setSelectedSessionId(null);
        setNewSessionMode(true);
      }
    });
    return () => {
      active = false;
    };
  }, [props.chat.workspaceId, props.ownerUserId]);

  useEffect(() => {
    if (!workspace || !pendingPrompt || pendingPromptFailed || pendingPrompt.dispatchedSessionId) return;
    const status = workspace.workspaceStatus ?? workspace.status;
    if (status !== "ready") {
      setPendingPromptStatus("Workspace is provisioning; the prompt will send when ready.");
      return;
    }
    if (!workspace.targetId || !workspace.anyharnessWorkspaceId || dispatchingRef.current) return;

    dispatchingRef.current = true;
    setPendingPromptStatus("Starting a session for the queued prompt.");
    void dispatchPendingMobilePrompt({
      client,
      workspace,
      pendingPrompt,
      enqueueStartSession,
      enqueuePrompt,
      onStatus: setPendingPromptStatus,
    })
      .then((sessionId) => {
        const dispatched = { ...pendingPrompt, dispatchedSessionId: sessionId };
        setPendingPrompt(dispatched);
        setSelectedSessionId(sessionId);
        setNewSessionMode(false);
        props.onSessionSelected?.(sessionId);
        if (props.ownerUserId) {
          void savePendingMobilePrompt(workspace.id, props.ownerUserId, dispatched);
        }
      })
      .catch((caught) => {
        setPendingPromptFailed(true);
        setPendingPromptStatus(caught instanceof Error ? caught.message : "Queued prompt could not be sent.");
      })
      .finally(() => {
        dispatchingRef.current = false;
      });
  }, [workspace, pendingPrompt, pendingPromptFailed]);

  async function submitPrompt() {
    const text = draft.trim();
    if (!text || !workspace) return;

    if (!session) {
      if (!props.ownerUserId) return;
      const prompt: MobilePendingPrompt = {
        id: `mobile-chat:${workspace.id}:${Date.now().toString(36)}`,
        text,
        modelId: "gpt-5.4",
        modeId: null,
        createdAt: Date.now(),
      };
      setDraft("");
      setPendingPrompt(prompt);
      setPendingPromptStatus("Starting a session for this prompt.");
      await savePendingMobilePrompt(workspace.id, props.ownerUserId, prompt).catch(() => undefined);
      return;
    }

    setDraft("");
    await enqueuePrompt.mutateAsync({
      idempotencyKey: `mobile:${workspace.id}:${session.sessionId}:${Date.now()}`,
      targetId: session.targetId,
      workspaceId: session.workspaceId,
      cloudWorkspaceId: workspace.id,
      sessionId: session.sessionId,
      kind: "send_prompt",
      source: "mobile",
      payload: { text },
    });
  }

  async function claimChat() {
    if (!workspace) return;
    await claimWorkspace.mutateAsync({ workspaceId: workspace.id });
    setClaimedLocally(true);
    void workspaceQuery.refetch();
  }

  async function updateSessionConfig(configId: string, value: string) {
    if (!workspace || !session) return;
    await enqueueConfig.mutateAsync({
      idempotencyKey: `mobile:${workspace.id}:${session.sessionId}:config:${configId}:${value}:${Date.now()}`,
      targetId: session.targetId,
      workspaceId: session.workspaceId,
      cloudWorkspaceId: workspace.id,
      sessionId: session.sessionId,
      kind: "update_session_config",
      source: "mobile",
      observedEventSeq: session.lastEventSeq ?? null,
      payload: { configId, value },
    });
  }

  return (
    <Screen>
      <TopBar
        title={newSessionMode ? "New session" : session?.title ?? props.chat.title}
        subtitle={`${workspace?.displayName ?? props.chat.workspaceName} - ${workspace?.repo.owner ?? props.chat.repoLabel}`}
        leading="back"
        onLeadingPress={props.onBack}
        trailing="sessions"
        onTrailingPress={() => setSessionPickerOpen(true)}
      />

      <ChipRow>
        <Chip label={workspace?.repo.branch ?? workspace?.repo.baseBranch ?? props.chat.branchLabel} />
        <Chip label={workspace?.visibility ?? props.chat.visibility} />
        <Chip label={sessionLive.isConnected ? "Live" : "Snapshot"} />
        <Chip label={session ? "Existing session" : "New session"} />
      </ChipRow>

      {isUnclaimed ? (
        <Banner
          title="Unclaimed shared chat"
          body="Claim this work before sending prompts from mobile."
          actionLabel="Claim"
          onAction={() => void claimChat()}
        />
      ) : null}

      <ScrollView>
        {transcriptRows.length === 0 ? (
          <Centered
            title={session ? "Waiting for transcript" : "No active session yet"}
            body={session ? "Transcript projection will appear here." : "Send a prompt below to start a projected session."}
          />
        ) : (
          transcriptRows.map((row) => (
            <MessageBubble key={row.id} role={row.role} body={row.body} status={row.status} />
          ))
        )}
        {pendingPromptStatus ? <Caption>{pendingPromptStatus}</Caption> : null}
      </ScrollView>

      <ComposerConfigBar
        session={session}
        onUpdateConfig={(configId, value) => void updateSessionConfig(configId, value)}
      />

      <Composer
        value={draft}
        onChangeText={setDraft}
        placeholder={isUnclaimed ? "Claim this workspace to reply" : session ? "Message this session" : workspaceReady ? "Start a session with a message" : "Waiting for workspace"}
        disabled={!canSubmit}
        onSend={() => void submitPrompt()}
      />

      <SessionPickerSheet
        visible={sessionPickerOpen}
        sessions={sessions}
        activeSessionId={session?.sessionId ?? null}
        onClose={() => setSessionPickerOpen(false)}
        onStartNew={() => {
          setSelectedSessionId(null);
          setNewSessionMode(true);
          setSessionPickerOpen(false);
        }}
        onSelect={(sessionId) => {
          setSelectedSessionId(sessionId);
          setNewSessionMode(false);
          setSessionPickerOpen(false);
          props.onSessionSelected?.(sessionId);
        }}
      />
    </Screen>
  );
}

function MobileAutomationsScreen() {
  const [showNew, setShowNew] = useState(false);
  const automations = useAutomations({ ownerScope: "personal" });
  const pauseAutomation = usePauseAutomation({ ownerScope: "personal" });
  const resumeAutomation = useResumeAutomation({ ownerScope: "personal" });

  async function toggle(automation: AutomationResponse) {
    if (automation.enabled) {
      await pauseAutomation.mutateAsync(automation.id);
    } else {
      await resumeAutomation.mutateAsync(automation.id);
    }
  }

  return (
    <Screen title="Automations" subtitle="Cloud automations for personal workspaces.">
      <Button label="New" onPress={() => setShowNew(true)} />

      {automations.isLoading ? (
        <Centered title="Loading automations" />
      ) : (automations.data?.automations ?? []).length === 0 ? (
        <Centered title="No automations yet" body="Create a personal cloud automation from mobile." />
      ) : (
        (automations.data?.automations ?? []).map((automation) => (
          <ListRow
            key={automation.id}
            title={automation.title}
            subtitle={`${automation.schedule.summary} - ${automation.gitOwner}/${automation.gitRepoName}`}
            meta={automation.enabled ? "On" : "Paused"}
            onPress={() => void toggle(automation)}
          />
        ))
      )}

      <Caption>Desktop still runs automation kinds that need local compute, browser, or computer use.</Caption>
      <NewAutomationSheet visible={showNew} onClose={() => setShowNew(false)} />
    </Screen>
  );
}

function NewAutomationSheet(props: { visible: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [repoId, setRepoId] = useState("");
  const [configId, setConfigId] = useState("");
  const [cadence, setCadence] = useState<"daily" | "weekly">("daily");

  const repoConfigs = useCloudRepoConfigs(props.visible);
  const agentConfigs = useCloudAgentRunConfigs(
    { usableIn: "personal_sandboxes", status: "active" },
    props.visible,
  );
  const createAutomation = useCreateAutomation({ ownerScope: "personal" });

  const repos = (repoConfigs.data?.configs ?? [])
    .filter((repo) => repo.configured)
    .map((repo) => ({
      id: `${repo.gitOwner}/${repo.gitRepoName}`,
      gitOwner: repo.gitOwner,
      gitRepoName: repo.gitRepoName,
      label: `${repo.gitOwner}/${repo.gitRepoName}`,
    }));
  const runConfigs = (agentConfigs.data?.configs ?? [])
    .filter((config: CloudAgentRunConfig) => config.status === "active" && config.usableInPersonalSandboxes);

  const selectedRepo = repos.find((repo) => repo.id === repoId) ?? repos[0] ?? null;
  const selectedConfig = runConfigs.find((config: CloudAgentRunConfig) => config.id === configId) ?? runConfigs[0] ?? null;

  async function submit() {
    if (!selectedRepo || !selectedConfig || !prompt.trim()) return;
    await createAutomation.mutateAsync({
      title: title.trim() || prompt.trim().slice(0, 48) || "Mobile automation",
      prompt: prompt.trim(),
      ownerScope: "personal",
      gitOwner: selectedRepo.gitOwner,
      gitRepoName: selectedRepo.gitRepoName,
      targetMode: "personal_cloud",
      cloudAgentRunConfigId: selectedConfig.id,
      schedule: {
        rrule: cadence === "daily" ? "FREQ=DAILY;INTERVAL=1" : "FREQ=WEEKLY;INTERVAL=1",
        timezone: "local-device-timezone",
      },
    });
    props.onClose();
  }

  return (
    <Modal visible={props.visible} transparent animationType="slide">
      <Sheet title="New automation" onClose={props.onClose}>
        <Section title="Repository">
          {repos.map((repo) => (
            <ChoiceRow key={repo.id} label={repo.label} selected={repo.id === selectedRepo?.id} onPress={() => setRepoId(repo.id)} />
          ))}
        </Section>
        <Section title="Agent config">
          {runConfigs.map((config: CloudAgentRunConfig) => (
            <ChoiceRow
              key={config.id}
              label={`${config.name} - ${config.agentKind}${config.modelId ? ` / ${config.modelId}` : ""}`}
              selected={config.id === selectedConfig?.id}
              onPress={() => setConfigId(config.id)}
            />
          ))}
        </Section>
        <Section title="Cadence">
          <ChoiceRow label="Daily" selected={cadence === "daily"} onPress={() => setCadence("daily")} />
          <ChoiceRow label="Weekly" selected={cadence === "weekly"} onPress={() => setCadence("weekly")} />
        </Section>
        <Section title="Title">
          <TextInput value={title} onChangeText={setTitle} placeholder="Daily dependency triage" />
        </Section>
        <Section title="Prompt">
          <TextInput value={prompt} onChangeText={setPrompt} multiline placeholder="Describe the recurring work..." />
        </Section>
        <Button label={createAutomation.isPending ? "Creating..." : "Create automation"} onPress={() => void submit()} />
      </Sheet>
    </Modal>
  );
}

function MobileSettingsScreen(props: { onSignOut: () => void }) {
  const viewer = useAuthViewer();
  const organizations = useOrganizations();
  const billing = useCloudBilling({ ownerScope: "personal" });
  const repoConfigs = useCloudRepoConfigs();
  const configuredRepos = (repoConfigs.data?.configs ?? []).filter((repo) => repo.configured);

  return (
    <Screen title={viewer.data?.user.display_name ?? viewer.data?.user.email ?? "Account"}>
      <Section title="Account">
        <ListRow title="GitHub" subtitle="Required for cloud sessions" meta={viewer.data?.githubConnected ? "Linked" : "Required"} />
        <ListRow title="Auth state" subtitle={viewer.data?.onboardingState === "active" ? "Signed in and GitHub-linked" : "GitHub link required"} />
      </Section>
      <Section title="Cloud">
        <ListRow title="Personal plan" subtitle={billing.data ? `${billing.data.plan} - ${billing.data.paymentHealthy ? "ready" : "payment attention"}` : "Loading cloud plan..."} />
        <ListRow title="Configured repositories" subtitle={`${configuredRepos.length} ready for mobile new chat`} />
      </Section>
      <Section title="Teams">
        {(organizations.data?.organizations ?? []).map((org) => (
          <ListRow key={org.id} title={org.name} subtitle={`${org.membership?.role ?? "member"} access`} />
        ))}
      </Section>
      <Section title="Configure on web or desktop">
        <ListRow
          title="MCPs, skills, and billing actions"
          subtitle="Advanced cloud setup still opens on Web or Desktop"
          meta="Web"
        />
      </Section>
      <Button label="Sign out" onPress={props.onSignOut} secondary />
      <Caption>Proliferate Mobile - build 0.1.0</Caption>
    </Screen>
  );
}

/**
 * Pending first-prompt handoff:
 * 1. Home creates workspace and stores prompt.
 * 2. Chat opens before workspace is ready.
 * 3. Chat waits for workspace ready + targetId + anyharnessWorkspaceId.
 * 4. Mobile enqueues start_session.
 * 5. Mobile waits for projected session.
 * 6. Mobile enqueues send_prompt.
 * 7. Prompt is cleared from storage once transcript progress is durable.
 */
async function dispatchPendingMobilePrompt(input: {
  client: unknown;
  workspace: CloudWorkspaceDetail;
  pendingPrompt: MobilePendingPrompt;
  enqueueStartSession: ReturnType<typeof useEnqueueCloudCommand>;
  enqueuePrompt: ReturnType<typeof useEnqueueCloudCommand>;
  onStatus: (status: string) => void;
}): Promise<string> {
  const targetId = input.workspace.targetId;
  const workspaceId = input.workspace.anyharnessWorkspaceId;
  if (!targetId || !workspaceId) {
    throw new Error("Workspace is ready but missing runtime command routing.");
  }

  const agentKind = input.workspace.readyAgentKinds?.includes("codex")
    ? "codex"
    : input.workspace.readyAgentKinds?.[0] ?? input.workspace.allowedAgentKinds?.[0] ?? "codex";

  input.onStatus("Starting session.");
  const start = await input.enqueueStartSession.mutateAsync({
    idempotencyKey: `${input.pendingPrompt.id}:start-session`,
    targetId,
    workspaceId,
    cloudWorkspaceId: input.workspace.id,
    kind: "start_session",
    source: "mobile",
    payload: {
      workspaceId,
      agentKind,
      modelId: agentKind === "codex" ? input.pendingPrompt.modelId : null,
      modeId: input.pendingPrompt.modeId,
      subagentsEnabled: false,
      origin: { kind: "system", entrypoint: "cloud" },
    },
  });

  const sessionId = start.sessionId ?? start.result?.sessionId ?? "projected-session-id";

  input.onStatus("Sending queued prompt.");
  await input.enqueuePrompt.mutateAsync({
    idempotencyKey: `${input.pendingPrompt.id}:send`,
    targetId,
    workspaceId,
    cloudWorkspaceId: input.workspace.id,
    sessionId,
    kind: "send_prompt",
    source: "mobile",
    payload: {
      text: input.pendingPrompt.text,
      promptId: input.pendingPrompt.id,
    },
  });

  return sessionId;
}

/**
 * Current limitations worth preserving for the next UI iteration:
 *
 * - Workspaces and Sessions both use scope "my"; this is not yet a clean
 *   claimable/team inbox.
 * - Home creates personal cloud work only.
 * - Automations are personal cloud only, daily/weekly only, with no run detail.
 * - Settings is status/readiness only.
 * - Chat is the strongest surface: live/snapshot transcript, claim, session
 *   switching, config controls, optimistic prompt rows, pending first-prompt
 *   handoff.
 * - Mobile should probably become "what needs me and can I act quickly", not a
 *   full shared sandbox/admin console.
 */

/* -------------------------------------------------------------------------- */
/* Tiny placeholder UI primitives and fake hooks for handoff readability.       */
/* -------------------------------------------------------------------------- */

function Screen(props: { title?: string; subtitle?: string; children: ReactNode }) {
  return (
    <View style={{ flex: 1, padding: 16, gap: 16 }}>
      {props.title ? <Text style={{ fontSize: 24, fontWeight: "700" }}>{props.title}</Text> : null}
      {props.subtitle ? <Text>{props.subtitle}</Text> : null}
      {props.children}
    </View>
  );
}

function TopBar(props: {
  title: string;
  subtitle?: string;
  leading?: "menu" | "back";
  trailing?: string;
  onLeadingPress?: () => void;
  onTrailingPress?: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      {props.leading ? <Button label={props.leading} onPress={props.onLeadingPress ?? (() => undefined)} /> : null}
      <View style={{ flex: 1 }}>
        <Text>{props.title}</Text>
        {props.subtitle ? <Caption>{props.subtitle}</Caption> : null}
      </View>
      {props.trailing ? <Button label={props.trailing} onPress={props.onTrailingPress ?? (() => undefined)} /> : null}
    </View>
  );
}

function MobileDrawer(props: {
  activeRoute: MobileRouteId;
  onNavigate: (route: MobileRouteId) => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  return (
    <Modal transparent>
      <Sheet title="Proliferate" onClose={props.onClose}>
        {ROUTES.map((route) => (
          <Button
            key={route.id}
            label={`${route.label}${props.activeRoute === route.id ? " selected" : ""}`}
            onPress={() => props.onNavigate(route.id)}
          />
        ))}
        <Button label="Sign out" onPress={props.onSignOut} secondary />
      </Sheet>
    </Modal>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontWeight: "700" }}>{props.title}</Text>
      {props.children}
    </View>
  );
}

function ListRow(props: {
  title: string;
  subtitle?: string;
  meta?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={props.onPress} style={{ paddingVertical: 12 }}>
      <Text>{props.title}</Text>
      {props.subtitle ? <Caption>{props.subtitle}</Caption> : null}
      {props.meta ? <Caption>{props.meta}</Caption> : null}
    </Pressable>
  );
}

function ChoiceRow(props: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ paddingVertical: 10 }}>
      <Text>{props.selected ? `[x] ${props.label}` : `[ ] ${props.label}`}</Text>
    </Pressable>
  );
}

function Button(props: { label: string; onPress?: () => void; secondary?: boolean }) {
  return (
    <Pressable onPress={props.onPress} style={{ padding: 10 }}>
      <Text>{props.secondary ? props.label : props.label}</Text>
    </Pressable>
  );
}

function FloatingButton(props: { label: string; onPress: () => void }) {
  return <Button label={props.label} onPress={props.onPress} />;
}

function Centered(props: { title: string; body?: string }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: 32 }}>
      <Text>{props.title}</Text>
      {props.body ? <Caption>{props.body}</Caption> : null}
    </View>
  );
}

function Caption(props: { children: ReactNode }) {
  return <Text style={{ opacity: 0.65 }}>{props.children}</Text>;
}

function ErrorText(props: { children: ReactNode }) {
  return <Text style={{ color: "red" }}>{props.children}</Text>;
}

function ChipRow(props: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{props.children}</View>;
}

function Chip(props: { label: string }) {
  return <Text>{props.label}</Text>;
}

function Banner(props: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View>
      <Text>{props.title}</Text>
      <Caption>{props.body}</Caption>
      <Button label={props.actionLabel} onPress={props.onAction} />
    </View>
  );
}

function MessageBubble(props: { role: string; body?: string | null; status?: string | null }) {
  return (
    <View style={{ paddingVertical: 8 }}>
      <Caption>{props.role}{props.status ? ` - ${props.status}` : ""}</Caption>
      <Text>{props.body}</Text>
    </View>
  );
}

function Composer(props: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  onSend: () => void;
}) {
  return (
    <View>
      <TextInput value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} multiline />
      <Button label="Send" onPress={props.disabled ? undefined : props.onSend} />
    </View>
  );
}

function ComposerConfigBar(_props: {
  session: CloudSessionProjection | null;
  onUpdateConfig: (configId: string, value: string) => void;
}) {
  return <ChipRow><Chip label="model/mode controls appear here when exposed by session live config" /></ChipRow>;
}

function SessionPickerSheet(props: {
  visible: boolean;
  sessions: CloudSessionProjection[];
  activeSessionId: string | null;
  onClose: () => void;
  onStartNew: () => void;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <Modal visible={props.visible} transparent animationType="slide">
      <Sheet title="Workspace sessions" onClose={props.onClose}>
        <Button label="New session" onPress={props.onStartNew} />
        {props.sessions.map((session) => (
          <ListRow
            key={session.sessionId}
            title={session.title ?? session.sessionId.slice(0, 8)}
            subtitle={session.status}
            meta={props.activeSessionId === session.sessionId ? "Selected" : undefined}
            onPress={() => props.onSelect(session.sessionId)}
          />
        ))}
      </Sheet>
    </Modal>
  );
}

function Sheet(props: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <View style={{ padding: 16, gap: 12, backgroundColor: "#181818" }}>
      <TopBar title={props.title} trailing="close" onTrailingPress={props.onClose} />
      {props.children}
    </View>
  );
}

function routeLabel(route: MobileRouteId): string {
  return ROUTES.find((candidate) => candidate.id === route)?.label ?? "Home";
}

function routeSubtitle(route: MobileRouteId): string {
  switch (route) {
    case "home": return "New chat";
    case "workspaces": return "Cloud sandboxes";
    case "sessions": return "Running and recent";
    case "automations": return "Scheduled runs";
    case "settings": return "Account and device";
  }
}

function chatFromWorkspace(
  workspace: CloudWorkspaceSummary,
  pendingPrompt: MobilePendingPrompt | null = null,
): MobileCloudChat {
  const session = workspace.lastSessionSummary;
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.displayName ?? workspace.repo.name,
    repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
    branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
    targetId: workspace.targetId ?? session?.targetId ?? null,
    workspaceRuntimeId: workspace.anyharnessWorkspaceId ?? session?.workspaceId ?? null,
    sessionId: session?.sessionId ?? null,
    title: session?.title ?? workspace.displayName ?? workspace.repo.name,
    status: session?.status ?? workspace.workspaceStatus ?? workspace.status,
    visibility: workspace.visibility,
    initialPendingPrompt: pendingPrompt,
  };
}

function chatFromSession(
  workspace: CloudWorkspaceSummary,
  session: CloudSessionProjection,
): MobileCloudChat {
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.displayName ?? workspace.repo.name,
    repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
    branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
    targetId: session.targetId,
    workspaceRuntimeId: session.workspaceId ?? null,
    sessionId: session.sessionId,
    title: session.title ?? workspace.displayName ?? workspace.repo.name,
    status: session.status,
    visibility: workspace.visibility,
  };
}

function sessionFromSummary(workspace: CloudWorkspaceSummary): CloudSessionProjection {
  const session = workspace.lastSessionSummary;
  if (!session) throw new Error("Missing last session summary.");
  return {
    targetId: session.targetId,
    cloudWorkspaceId: workspace.id,
    workspaceId: session.workspaceId ?? null,
    sessionId: session.sessionId,
    title: session.title ?? null,
    status: session.status,
    lastEventSeq: 0,
    lastEventAt: session.lastEventAt ?? null,
  };
}

function compareSessionRecency(left: CloudSessionProjection, right: CloudSessionProjection): number {
  const rightTime = Date.parse(right.lastEventAt ?? right.startedAt ?? "") || 0;
  const leftTime = Date.parse(left.lastEventAt ?? left.startedAt ?? "") || 0;
  return rightTime - leftTime || (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0);
}

function buildMobileBranchName(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    || "mobile-chat";
  return `proliferate/${slug}-${Date.now().toString(36).slice(-6)}`;
}

function buildMobileDisplayName(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length <= 42 ? normalized || "Mobile chat" : `${normalized.slice(0, 39).trimEnd()}...`;
}

function buildCloudTranscriptRows(input: {
  sessionId: string | null;
  events: unknown[];
  fallbackItems: unknown[];
  pendingInteractions: unknown[];
  pendingPrompt: MobilePendingPrompt | null;
  pendingPromptStatus: string | null;
  pendingPromptFailed: boolean;
}): Array<{ id: string; role: string; body?: string | null; status?: string | null }> {
  const baseRows = input.events.length || input.fallbackItems.length
    ? [{ id: "real-transcript", role: "system", body: "Transcript rows built from Cloud events/items." }]
    : [];
  if (!input.pendingPrompt) return baseRows;
  return [
    ...baseRows,
    {
      id: `${input.pendingPrompt.id}:user`,
      role: "you",
      body: input.pendingPrompt.text,
      status: input.pendingPromptFailed ? "Failed" : "Queued",
    },
    {
      id: `${input.pendingPrompt.id}:assistant`,
      role: "assistant",
      body: input.pendingPromptFailed
        ? input.pendingPrompt.failureMessage ?? input.pendingPromptStatus ?? "Queued prompt could not be sent."
        : input.pendingPrompt.dispatchedSessionId
          ? "Waiting for response..."
          : "Preparing workspace and session...",
    },
  ];
}

async function savePendingMobilePrompt(_workspaceId: string, _ownerUserId: string, _prompt: MobilePendingPrompt) {}
async function loadPendingMobilePrompt(_workspaceId: string, _ownerUserId: string): Promise<MobilePendingPrompt | null> { return null; }

function useMobileAuth() {
  return {
    authState: "active" as AuthState,
    accessToken: "token",
    user: { id: "user", email: "user@example.com", display_name: "User" },
    loadingAction: null as AuthProviderName | "github_link" | null,
    error: null as string | null,
    signInWithProvider: async (_provider: AuthProviderName) => undefined,
    connectGitHub: async () => undefined,
    signOut: async () => undefined,
  };
}

function useCloudRepoConfigs(_enabled = true) {
  return { isLoading: false, isError: false, data: { configs: [] as Array<{ gitOwner: string; gitRepoName: string; configured: boolean }> }, refetch: async () => undefined };
}
function useCreateCloudWorkspace() {
  return { isPending: false, mutateAsync: async (_input: unknown): Promise<CloudWorkspaceSummary> => ({ id: "workspace", displayName: "Workspace", repo: { owner: "owner", name: "repo", branch: "main" }, visibility: "private", status: "pending" }) };
}
function useCloudWorkspaces(_input: unknown) {
  return { isLoading: false, error: null, data: [] as CloudWorkspaceSummary[] };
}
function useCloudWorkspaceSnapshot(_workspaceId: string | null, _enabled = true) {
  return { data: null as null | { workspace: CloudWorkspaceDetail; sessions: CloudSessionProjection[] }, refetch: async () => undefined };
}
function useWorkspaceLive(_workspaceId: string, _options: unknown) {
  return { snapshot: null as null | { workspace: CloudWorkspaceDetail; sessions: CloudSessionProjection[] } };
}
function useSessionLive(_sessionId: string | null, _options: unknown) {
  return { isConnected: false, snapshot: null as null | { transcriptItems: unknown[]; pendingInteractions: unknown[] } };
}
function useCloudTranscriptSnapshot(_targetId: string | null | undefined, _sessionId: string | null, _enabled: boolean) {
  return { data: null as null | { transcriptItems: unknown[] } };
}
function useCloudSessionEvents(_targetId: string | null | undefined, _sessionId: string | null, _enabled: boolean) {
  return { data: { events: [] as unknown[] } };
}
function useCloudClient() {
  return {};
}
function useEnqueueCloudCommand() {
  return { mutateAsync: async (input: any) => ({ commandId: "command", status: "accepted", ...input }) };
}
function useClaimCloudWorkspace() {
  return { mutateAsync: async (_input: unknown) => undefined };
}
function useAutomations(_input: unknown) {
  return { isLoading: false, data: { automations: [] as AutomationResponse[] } };
}
function usePauseAutomation(_input: unknown) {
  return { mutateAsync: async (_id: string) => undefined };
}
function useResumeAutomation(_input: unknown) {
  return { mutateAsync: async (_id: string) => undefined };
}
function useCreateAutomation(_input: unknown) {
  return { isPending: false, mutateAsync: async (_input: unknown) => undefined };
}
function useCloudAgentRunConfigs(_input: unknown, _enabled: boolean) {
  return { data: { configs: [] as CloudAgentRunConfig[] } };
}
function useAuthViewer() {
  return { data: null as null | { user: { email?: string | null; display_name?: string | null }; githubConnected: boolean; onboardingState: string } };
}
function useOrganizations() {
  return { data: { organizations: [] as Array<{ id: string; name: string; membership?: { role?: string | null } | null }> } };
}
function useCloudBilling(_input: unknown) {
  return { data: null as null | { plan: string; paymentHealthy: boolean } };
}
