import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Keyboard,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { AuthUser, CloudSessionProjection, CloudWorkspaceDetail } from "@proliferate/cloud-sdk";
import { useCloudWorkspaceSnapshot } from "@proliferate/cloud-sdk-react";

import { MobileAuthScreen } from "../auth/MobileAuthScreen";
import { MobileConnectGitHubScreen } from "../auth/MobileConnectGitHubScreen";
import { MobileOnboardingScreen } from "../onboarding/MobileOnboardingScreen";
import { MobileAutomationsScreen } from "../automations/MobileAutomationsScreen";
import { MobileChatScreen } from "../chat/MobileChatScreen";
import { MobileHomeScreen } from "../home/MobileHomeScreen";
import { MobileSettingsScreen } from "../settings/MobileSettingsScreen";
import {
  MobileDrawer,
  type MobileDrawerAccountSummary,
} from "./drawer/MobileDrawer";
import { MobileTopBar } from "../primitives/MobileTopBar";
import { MobileWorkspacesScreen } from "../work/MobileAllWorkScreen";
import { useMobileClientDailyActivity } from "../../hooks/telemetry/lifecycle/use-mobile-client-daily-activity";
import { useMobileScreenTelemetry } from "../../hooks/telemetry/lifecycle/use-mobile-screen-telemetry";
import {
  deleteMobileStorageItem,
  getMobileStorageItem,
  setMobileStorageItem,
} from "../../lib/access/mobile-storage";
import {
  allWorkRoute,
  drawerRoutes,
  routeTitle,
  type MobileCloudChat,
  type RouteId,
} from "../../navigation/navigation-model";
import { useMobileAuth } from "../../providers/MobileAuthProvider";
import { colors, spacing } from "../../styles/tokens";

const SHELL_ROUTE_KEY = "proliferate.mobile.shell.route";
const SHELL_CHAT_KEY = "proliferate.mobile.shell.chat";
const SHELL_STORAGE_VERSION = 1;
const ONBOARDING_FLAG_KEY = "proliferate.mobile.onboarded.v1";
const DRAWER_WIDTH = Math.min(300, Math.round(Dimensions.get("window").width * 0.76));

export function MobileShell() {
  const {
    authState,
    accessToken,
    user,
    signInWithProvider,
    signInWithPassword,
    connectGitHub,
    signOut,
    loadingAction,
    error,
  } = useMobileAuth();
  const [route, setRoute] = useState<RouteId>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedChat, setSelectedChat] = useState<MobileCloudChat | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<"checking" | "needed" | "done">("checking");
  const [linkedWorkspaceId, setLinkedWorkspaceId] = useState<string | null>(null);
  const [linkedWorkspaceSessionId, setLinkedWorkspaceSessionId] = useState<string | null>(null);
  const [initialLinkChecked, setInitialLinkChecked] = useState(false);
  const [navigationRestored, setNavigationRestored] = useState(false);
  const initialLinkAppliedRef = useRef(false);
  const linkedWorkspace = useCloudWorkspaceSnapshot(
    linkedWorkspaceId,
    authState === "active" && linkedWorkspaceId !== null,
  );

  const subtitle = useMemo(() => routeSubtitle(route), [route]);
  const account = useMemo(() => accountSummary(user), [user]);
  const telemetryScreen = selectedChat ? "chat" : route;
  const ownerUserId = user?.id ?? null;

  useMobileScreenTelemetry(authState, telemetryScreen);
  const canRecordAuthenticatedActivity = authState === "active" || authState === "needs_github";
  useMobileClientDailyActivity({
    accessToken: canRecordAuthenticatedActivity ? accessToken : null,
    actorStorageKey: user?.id ?? null,
    routeOrScreen: authState === "needs_github" ? "connect_github" : telemetryScreen,
    viewingChat: authState === "active" && selectedChat !== null,
  });
  const applyWorkspaceLink = useCallback((url: string | null): boolean => {
    const link = workspaceLinkFromUrl(url);
    if (!link) {
      return false;
    }
    initialLinkAppliedRef.current = true;
    setLinkedWorkspaceId(link.workspaceId);
    setLinkedWorkspaceSessionId(link.sessionId);
    setRoute("work");
    setSelectedChat(null);
    setDrawerOpen(false);
    return true;
  }, []);

  useEffect(() => {
    let active = true;
    void Linking.getInitialURL()
      .then((url) => {
        if (active) {
          applyWorkspaceLink(url);
        }
      })
      .finally(() => {
        if (active) {
          setInitialLinkChecked(true);
        }
      });
    const subscription = Linking.addEventListener("url", ({ url }) => {
      applyWorkspaceLink(url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [applyWorkspaceLink]);

  useEffect(() => {
    if (authState !== "active") {
      setOnboardingStatus("checking");
      return;
    }
    let cancelled = false;
    void getMobileStorageItem(ONBOARDING_FLAG_KEY)
      .then((value) => {
        if (cancelled) return;
        setOnboardingStatus(value === "true" ? "done" : "needed");
      })
      .catch(() => {
        if (!cancelled) setOnboardingStatus("needed");
      });
    return () => {
      cancelled = true;
    };
  }, [authState]);

  const completeOnboarding = useCallback(async () => {
    try {
      await setMobileStorageItem(ONBOARDING_FLAG_KEY, "true");
    } catch {
      // best effort
    }
    setOnboardingStatus("done");
  }, []);

  useEffect(() => {
    if (authState !== "active") {
      setNavigationRestored(false);
      return;
    }
    if (!initialLinkChecked) {
      return;
    }
    if (initialLinkAppliedRef.current) {
      setNavigationRestored(true);
      return;
    }
    if (!ownerUserId) {
      return;
    }
    let cancelled = false;
    void restoreShellNavigation(ownerUserId)
      .then((stored) => {
        if (cancelled) {
          return;
        }
        if (stored.route) {
          setRoute(stored.route);
        }
        if (stored.chat) {
          setSelectedChat(stored.chat);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setNavigationRestored(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authState, initialLinkChecked, ownerUserId]);

  useEffect(() => {
    if (authState !== "active" || !navigationRestored || !ownerUserId) {
      return;
    }
    void persistShellNavigation(ownerUserId, route, selectedChat);
  }, [authState, navigationRestored, ownerUserId, route, selectedChat]);

  useEffect(() => {
    if (!linkedWorkspaceId || !linkedWorkspace.data) {
      return;
    }
    const chat = linkedChatForWorkspace(
      linkedWorkspace.data.workspace,
      linkedWorkspace.data.sessions,
      linkedWorkspaceSessionId,
    );
    if (chat) {
      setSelectedChat(chat);
    } else {
      setRoute("work");
    }
    setLinkedWorkspaceId(null);
    setLinkedWorkspaceSessionId(null);
  }, [linkedWorkspace.data, linkedWorkspaceId, linkedWorkspaceSessionId]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }
      if (selectedChat) {
        setSelectedChat(null);
        return true;
      }
      if (route !== "home") {
        setRoute("home");
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [drawerOpen, route, selectedChat]);

  function navigate(nextRoute: RouteId) {
    setRoute(nextRoute);
    setSelectedChat(null);
    setDrawerOpen(false);
  }

  function openChat(chat: MobileCloudChat) {
    setSelectedChat(chat);
    setDrawerOpen(false);
  }

  const markSelectedChatSession = useCallback((sessionId: string) => {
    setSelectedChat((current) => current ? { ...current, sessionId } : current);
  }, []);
  const clearSelectedChatInitialPendingPrompt = useCallback(() => {
    setSelectedChat((current) =>
      current?.initialPendingPrompt ? { ...current, initialPendingPrompt: null } : current
    );
  }, []);

  async function handleSignOut() {
    setRoute("home");
    setDrawerOpen(false);
    setSelectedChat(null);
    setLinkedWorkspaceId(null);
    setLinkedWorkspaceSessionId(null);
    setNavigationRestored(false);
    initialLinkAppliedRef.current = false;
    await clearShellNavigation(ownerUserId).catch(() => undefined);
    await signOut();
  }

  if (authState === "bootstrapping") {
    return (
      <SafeAreaView style={styles.root} edges={["top", "right", "bottom", "left"]}>
        <StatusBar style="light" />
        <View style={styles.loadingRoot}>
          <ActivityIndicator color={colors.fg} />
          <Text style={styles.loadingText}>Opening Proliferate</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (authState === "signed_out") {
    return (
      <SafeAreaView style={styles.root} edges={["top", "right", "bottom", "left"]}>
        <StatusBar style="light" />
        <MobileAuthScreen
          onProvider={(provider) => void signInWithProvider(provider)}
          onPassword={(email, password) => void signInWithPassword(email, password)}
          loadingAction={loadingAction}
          error={error}
        />
      </SafeAreaView>
    );
  }

  if (authState === "needs_github") {
    return (
      <SafeAreaView style={styles.root} edges={["top", "right", "bottom", "left"]}>
        <StatusBar style="light" />
        <MobileConnectGitHubScreen
          onConnect={() => void connectGitHub()}
          onSignOut={() => void handleSignOut()}
          loading={loadingAction === "github_link"}
          error={error}
        />
      </SafeAreaView>
    );
  }

  if (onboardingStatus === "needed") {
    return (
      <View style={styles.rootShell}>
        <StatusBar style="light" />
        <MobileOnboardingScreen onDone={() => void completeOnboarding()} />
      </View>
    );
  }

  return (
    <View style={styles.rootShell}>
      <StatusBar style="light" />

      <ShellWithDrawer
        drawerOpen={drawerOpen}
        setDrawerOpen={setDrawerOpen}
        drawer={
          <MobileDrawer
            activeRoute={selectedChat ? null : route}
            onNavigate={navigate}
            onOpenChat={openChat}
            onNewChat={() => navigate("home")}
            onClose={() => setDrawerOpen(false)}
            account={account}
          />
        }
      >
        {selectedChat ? (
          <MobileChatScreen
            chat={selectedChat}
            ownerUserId={ownerUserId}
            onBack={() => setSelectedChat(null)}
            onInitialPendingPromptConsumed={clearSelectedChatInitialPendingPrompt}
            onSessionSelected={markSelectedChatSession}
          />
        ) : route === "home" ? (
          <MobileHomeScreen
            ownerUserId={ownerUserId}
            onOpenChat={openChat}
            onOpenDrawer={() => setDrawerOpen(true)}
            onConfigureRepos={() => navigate("settings")}
          />
        ) : (
          <View style={styles.body}>
            {route === "work" ? (
              <MobileWorkspacesScreen
                onOpenChat={openChat}
                onOpenDrawer={() => setDrawerOpen(true)}
                onNewChat={() => navigate("home")}
              />
            ) : route === "automations" ? (
              <>
                <MobileTopBar
                  title={routeTitle(route)}
                  subtitle={subtitle}
                  leading={{ kind: "menu", onPress: () => setDrawerOpen(true) }}
                />
                <MobileAutomationsScreen />
              </>
            ) : (
              <>
                <MobileTopBar
                  title={routeTitle(route)}
                  subtitle={subtitle}
                  leading={{ kind: "menu", onPress: () => setDrawerOpen(true) }}
                />
                <MobileSettingsScreen account={account} onSignOut={() => void handleSignOut()} />
              </>
            )}
          </View>
        )}
      </ShellWithDrawer>

    </View>
  );
}

function ShellWithDrawer({
  drawerOpen,
  setDrawerOpen,
  drawer,
  children,
}: {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  drawer: React.ReactNode;
  children: React.ReactNode;
}) {
  const translate = useRef(new Animated.Value(0)).current;
  const [scrimReady, setScrimReady] = useState(false);
  const draggingRef = useRef(false);
  const scrimOpacity = useMemo(
    () => translate.interpolate({
      inputRange: [0, DRAWER_WIDTH],
      outputRange: [0, 0.4],
      extrapolate: "clamp",
    }),
    [translate],
  );
  const contentRadius = useMemo(
    () => translate.interpolate({
      inputRange: [0, 36],
      outputRange: [0, 30],
      extrapolate: "clamp",
    }),
    [translate],
  );
  const edgeOpacity = useMemo(
    () => translate.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
      extrapolate: "clamp",
    }),
    [translate],
  );

  function animateTo(open: boolean, velocity = 0) {
    Animated.timing(translate, {
      toValue: open ? DRAWER_WIDTH : 0,
      duration: Math.max(140, 260 - Math.abs(velocity) * 90),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      setDrawerOpen(open);
    });
  }

  useEffect(() => {
    if (drawerOpen) {
      Keyboard.dismiss();
    }
    if (draggingRef.current) return;
    Animated.timing(translate, {
      toValue: drawerOpen ? DRAWER_WIDTH : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    if (!drawerOpen) {
      setScrimReady(false);
      return;
    }
    const id = setTimeout(() => setScrimReady(true), 360);
    return () => clearTimeout(id);
  }, [drawerOpen, translate]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => {
          if (Math.abs(g.dy) > Math.abs(g.dx) * 1.2) return false;
          if (Math.abs(g.dx) < 8) return false;
          if (drawerOpen) return true;
          return g.x0 <= 28 && g.dx > 0;
        },
        onPanResponderGrant: () => {
          draggingRef.current = true;
          Keyboard.dismiss();
          (translate as Animated.Value).stopAnimation((v: number) => {
            (translate as Animated.Value).setValue(v);
          });
        },
        onPanResponderMove: (_e, g) => {
          const start = drawerOpen ? DRAWER_WIDTH : 0;
          const next = Math.max(0, Math.min(DRAWER_WIDTH, start + g.dx));
          translate.setValue(next);
        },
        onPanResponderRelease: (_e, g) => {
          draggingRef.current = false;
          const start = drawerOpen ? DRAWER_WIDTH : 0;
          const current = Math.max(0, Math.min(DRAWER_WIDTH, start + g.dx));
          let shouldOpen: boolean;
          if (g.vx > 0.4) shouldOpen = true;
          else if (g.vx < -0.4) shouldOpen = false;
          else shouldOpen = current > DRAWER_WIDTH / 2;
          animateTo(shouldOpen, g.vx);
          if (shouldOpen === drawerOpen) {
            // state already correct, just bounce-animate (done in animateTo)
          }
        },
        onPanResponderTerminate: () => {
          draggingRef.current = false;
          animateTo(drawerOpen);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawerOpen],
  );

  return (
    <View style={styles.shellContainer} {...panResponder.panHandlers}>
      <View
        style={[
          styles.staticDrawer,
          { width: DRAWER_WIDTH },
        ]}
        pointerEvents={drawerOpen ? "auto" : "none"}
      >
        {drawer}
      </View>
      <Animated.View
        style={[
          styles.slidingContent,
          {
            borderTopLeftRadius: contentRadius,
            borderBottomLeftRadius: contentRadius,
            transform: [{ translateX: translate }],
          },
        ]}
      >
        <SafeAreaView style={styles.slidingSafeArea} edges={["top", "right", "bottom", "left"]}>
          {children}
        </SafeAreaView>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.contentEdge,
            {
              borderTopLeftRadius: contentRadius,
              borderBottomLeftRadius: contentRadius,
              opacity: edgeOpacity,
            },
          ]}
        />
        <Animated.View
          style={[styles.contentScrim, { opacity: scrimOpacity }]}
          pointerEvents={drawerOpen && scrimReady ? "auto" : "none"}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
            onPress={() => setDrawerOpen(false)}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function accountSummary(user: AuthUser | null): MobileDrawerAccountSummary {
  const displayName = user?.display_name?.trim();
  const email = user?.email?.trim();
  const fallbackName = email?.split("@")[0] || "Proliferate";
  const name = displayName || fallbackName;
  return {
    initials: initialsForName(name),
    name,
    handle: email || "Signed in",
  };
}

function initialsForName(name: string): string {
  const parts = name
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) || "P").toUpperCase();
}

function routeSubtitle(route: RouteId): string | undefined {
  switch (route) {
    case "home":
      return "New chat";
    case "work":
      return "Workspaces";
    case "automations":
      return "Scheduled runs";
    case "settings":
      return "Account · device";
  }
}

function workspaceLinkFromUrl(url: string | null): { workspaceId: string; sessionId: string | null } | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const rawParts = parsed.pathname.split("/").filter(Boolean);
    const parts = parsed.protocol === "proliferate:"
      ? [parsed.hostname, ...rawParts]
      : rawParts;
    const workspaceIndex =
      parts[0] === "cloud" && parts[1] === "workspaces"
        ? 1
        : parts[0] === "workspaces"
          ? 0
          : -1;
    const workspaceId = workspaceIndex >= 0 ? parts[workspaceIndex + 1] : null;
    if (!workspaceId) {
      return null;
    }
    const sessionPathKind = parts[workspaceIndex + 2];
    const sessionId =
      sessionPathKind === "chats" || sessionPathKind === "sessions"
        ? parts[workspaceIndex + 3] ?? null
        : parsed.searchParams.get("sessionId");
    return {
      workspaceId: decodeURIComponent(workspaceId),
      sessionId: sessionId ? decodeURIComponent(sessionId) : null,
    };
  } catch {
    return null;
  }
}

interface StoredShellRoute {
  version: number;
  ownerUserId: string;
  route: RouteId;
  updatedAt: number;
}

interface StoredShellChat {
  version: number;
  ownerUserId: string;
  chat: MobileCloudChat;
  updatedAt: number;
}

async function restoreShellNavigation(ownerUserId: string): Promise<{
  chat: MobileCloudChat | null;
  route: RouteId | null;
}> {
  const [storedChat, storedRoute] = await Promise.all([
    getMobileStorageItem(shellChatKey(ownerUserId)),
    getMobileStorageItem(shellRouteKey(ownerUserId)),
  ]);
  void Promise.all([
    deleteMobileStorageItem(SHELL_CHAT_KEY),
    deleteMobileStorageItem(SHELL_ROUTE_KEY),
  ]).catch(() => undefined);
  const chat = parseStoredShellChat(storedChat, ownerUserId);
  const route = parseStoredShellRoute(storedRoute, ownerUserId);
  if (chat) {
    return { chat, route };
  }
  return { chat: null, route };
}

async function persistShellNavigation(
  ownerUserId: string,
  route: RouteId,
  selectedChat: MobileCloudChat | null,
): Promise<void> {
  if (selectedChat) {
    await Promise.all([
      setMobileStorageItem(
        shellChatKey(ownerUserId),
        JSON.stringify({
          version: SHELL_STORAGE_VERSION,
          ownerUserId,
          chat: chatForShellPersistence(selectedChat),
          updatedAt: Date.now(),
        } satisfies StoredShellChat),
      ),
      setMobileStorageItem(
        shellRouteKey(ownerUserId),
        JSON.stringify({
          version: SHELL_STORAGE_VERSION,
          ownerUserId,
          route,
          updatedAt: Date.now(),
        } satisfies StoredShellRoute),
      ),
    ]);
    return;
  }
  await Promise.all([
    deleteMobileStorageItem(shellChatKey(ownerUserId)),
    setMobileStorageItem(
      shellRouteKey(ownerUserId),
      JSON.stringify({
        version: SHELL_STORAGE_VERSION,
        ownerUserId,
        route,
        updatedAt: Date.now(),
      } satisfies StoredShellRoute),
    ),
  ]);
}

async function clearShellNavigation(ownerUserId: string | null): Promise<void> {
  const deletes = [
    deleteMobileStorageItem(SHELL_CHAT_KEY),
    deleteMobileStorageItem(SHELL_ROUTE_KEY),
  ];
  if (ownerUserId) {
    deletes.push(
      deleteMobileStorageItem(shellChatKey(ownerUserId)),
      deleteMobileStorageItem(shellRouteKey(ownerUserId)),
    );
  }
  await Promise.all(deletes);
}

function parseStoredShellRoute(value: string | null, ownerUserId: string): RouteId | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<StoredShellRoute>;
    if (parsed.version === SHELL_STORAGE_VERSION && parsed.ownerUserId === ownerUserId) {
      return parseStoredRouteId(parsed.route);
    }
  } catch {
    return null;
  }
  return null;
}

function parseStoredRouteId(value: unknown): RouteId | null {
  if (value === "workspaces" || value === "sessions") {
    return "work";
  }
  if (typeof value === "string") {
    if (value === allWorkRoute.id || drawerRoutes.some((route) => route.id === value)) {
      return value as RouteId;
    }
  }
  return null;
}

function parseStoredShellChat(value: string | null, ownerUserId: string): MobileCloudChat | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<StoredShellChat>;
    if (parsed.version === SHELL_STORAGE_VERSION && parsed.ownerUserId === ownerUserId) {
      return parseStoredChatValue(parsed.chat);
    }
  } catch {
    return null;
  }
  return null;
}

function parseStoredChatValue(value: unknown): MobileCloudChat | null {
  const parsed = value as Partial<MobileCloudChat>;
  if (
    typeof parsed.workspaceId === "string"
    && typeof parsed.workspaceName === "string"
    && typeof parsed.repoLabel === "string"
    && typeof parsed.branchLabel === "string"
    && (typeof parsed.targetId === "string" || parsed.targetId === null)
    && (typeof parsed.workspaceRuntimeId === "string" || parsed.workspaceRuntimeId === null)
    && (typeof parsed.sessionId === "string" || parsed.sessionId === null)
    && typeof parsed.title === "string"
    && typeof parsed.status === "string"
    && typeof parsed.visibility === "string"
  ) {
    return {
      workspaceId: parsed.workspaceId,
      workspaceName: parsed.workspaceName,
      repoLabel: parsed.repoLabel,
      branchLabel: parsed.branchLabel,
      targetId: parsed.targetId,
      workspaceRuntimeId: parsed.workspaceRuntimeId,
      sessionId: parsed.sessionId,
      title: parsed.title,
      status: parsed.status,
      visibility: parsed.visibility,
      initialPendingPrompt: null,
    };
  }
  return null;
}

function chatForShellPersistence(chat: MobileCloudChat): MobileCloudChat {
  if (!chat.initialPendingPrompt) {
    return chat;
  }
  return {
    ...chat,
    initialPendingPrompt: null,
  };
}

function shellRouteKey(ownerUserId: string): string {
  return `${SHELL_ROUTE_KEY}.${encodeURIComponent(ownerUserId)}`;
}

function shellChatKey(ownerUserId: string): string {
  return `${SHELL_CHAT_KEY}.${encodeURIComponent(ownerUserId)}`;
}

function linkedChatForWorkspace(
  workspace: CloudWorkspaceDetail,
  sessions: readonly CloudSessionProjection[],
  linkedSessionId: string | null,
): MobileCloudChat | null {
  const sortedSessions = [...sessions].sort(compareSessions);
  const session = linkedSessionId
    ? sortedSessions.find((candidate) => candidate.sessionId === linkedSessionId) ?? sortedSessions[0] ?? null
    : sortedSessions[0] ?? null;
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.displayName ?? workspace.repo.name,
    repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
    branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
    targetId: session?.targetId ?? workspace.targetId ?? null,
    workspaceRuntimeId: session?.workspaceId ?? workspace.anyharnessWorkspaceId ?? null,
    sessionId: session?.sessionId ?? null,
    title: session?.title ?? workspace.displayName ?? workspace.repo.name,
    status: session?.status ?? workspace.workspaceStatus ?? workspace.status,
    visibility: workspace.visibility,
  };
}

function compareSessions(left: CloudSessionProjection, right: CloudSessionProjection): number {
  return sessionRecencyMs(right) - sessionRecencyMs(left)
    || (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0);
}

function sessionRecencyMs(session: Pick<CloudSessionProjection, "lastEventAt" | "startedAt">): number {
  return Date.parse(session.lastEventAt ?? session.startedAt ?? "") || 0;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
    backgroundColor: colors.background,
  },
  loadingText: {
    color: colors.mutedForeground,
    fontSize: 13,
  },
  body: {
    flex: 1,
  },
  rootShell: {
    flex: 1,
    backgroundColor: colors.sidebar,
  },
  shellContainer: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: colors.sidebar,
  },
  staticDrawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 0,
  },
  slidingContent: {
    flex: 1,
    position: "relative",
    zIndex: 1,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  slidingSafeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentEdge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 32,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.borderHeavy,
    zIndex: 4,
  },
  contentScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
    zIndex: 5,
  },
  drawerGestureEdge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 24,
    zIndex: 10,
  },
});
