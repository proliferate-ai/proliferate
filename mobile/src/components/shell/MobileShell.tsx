import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
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
import { MobileAutomationsScreen } from "../automations/MobileAutomationsScreen";
import { MobileChatScreen } from "../chat/MobileChatScreen";
import { MobileHomeScreen } from "../home/MobileHomeScreen";
import { MobileIcon } from "../primitives/MobileIcon";
import { MobileProliferateMark } from "../primitives/MobileProliferateMark";
import { MobileSessionsScreen } from "../sessions/MobileSessionsScreen";
import { MobileSettingsScreen } from "../settings/MobileSettingsScreen";
import { MobileTopBar, MobileTopBarIconButton } from "../primitives/MobileTopBar";
import { MobileWorkspacesScreen } from "../workspaces/MobileWorkspacesScreen";
import { useMobileClientDailyActivity } from "../../hooks/telemetry/use-mobile-client-daily-activity";
import { useMobileScreenTelemetry } from "../../hooks/telemetry/use-mobile-screen-telemetry";
import {
  deleteMobileStorageItem,
  getMobileStorageItem,
  setMobileStorageItem,
} from "../../lib/access/mobile-storage";
import {
  drawerRoutes,
  routeTitle,
  type MobileCloudChat,
  type RouteId,
} from "../../navigation/navigation-model";
import { useMobileAuth } from "../../providers/MobileAuthProvider";
import { colors, radius, shadow, spacing } from "../../styles/tokens";

const SHELL_ROUTE_KEY = "proliferate.mobile.shell.route";
const SHELL_CHAT_KEY = "proliferate.mobile.shell.chat";
const SHELL_STORAGE_VERSION = 1;

export function MobileShell() {
  const {
    authState,
    accessToken,
    user,
    signInWithProvider,
    connectGitHub,
    signOut,
    loadingAction,
    error,
  } = useMobileAuth();
  const [route, setRoute] = useState<RouteId>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedChat, setSelectedChat] = useState<MobileCloudChat | null>(null);
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
    setRoute("workspaces");
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
        if (stored.chat) {
          setSelectedChat(stored.chat);
        } else if (stored.route) {
          setRoute(stored.route);
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
      setRoute("workspaces");
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

  return (
    <SafeAreaView style={styles.root} edges={["top", "right", "bottom", "left"]}>
      <StatusBar style="light" />

      {selectedChat ? (
        <MobileChatScreen
          chat={selectedChat}
          ownerUserId={ownerUserId}
          onBack={() => setSelectedChat(null)}
          onSessionSelected={markSelectedChatSession}
        />
      ) : (
        <>
          <MobileTopBar
            title={routeTitle(route)}
            subtitle={subtitle}
            leading={{ kind: "menu", onPress: () => setDrawerOpen(true) }}
            trailing={
              <MobileTopBarIconButton
                name={route === "home" ? "search" : "more"}
                accessibilityLabel="More"
              />
            }
          />

          <View style={styles.body}>
            {route === "home" ? (
              <MobileHomeScreen ownerUserId={ownerUserId} onOpenChat={openChat} />
            ) : route === "workspaces" ? (
              <MobileWorkspacesScreen onOpenChat={openChat} />
            ) : route === "sessions" ? (
              <MobileSessionsScreen onOpenChat={openChat} />
            ) : route === "automations" ? (
              <MobileAutomationsScreen />
            ) : (
              <MobileSettingsScreen account={account} onSignOut={() => void handleSignOut()} />
            )}
          </View>

          {route !== "home" && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New chat"
              onPress={() => navigate("home")}
              style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
            >
              <MobileIcon name="plus" size={22} color={colors.background} />
            </Pressable>
          )}
        </>
      )}

      {drawerOpen && (
        <Drawer
          activeRoute={route}
          onNavigate={navigate}
          onClose={() => setDrawerOpen(false)}
          onSignOut={() => void handleSignOut()}
          account={account}
        />
      )}
    </SafeAreaView>
  );
}

interface AccountSummary {
  initials: string;
  name: string;
  handle: string;
}

function accountSummary(user: AuthUser | null): AccountSummary {
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
    case "workspaces":
      return "Cloud sandboxes";
    case "sessions":
      return "Running and recent";
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
  if (chat) {
    return { chat, route: null };
  }
  return { chat: null, route: parseStoredShellRoute(storedRoute, ownerUserId) };
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
          chat: selectedChat,
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
    if (
      parsed.version === SHELL_STORAGE_VERSION
      && parsed.ownerUserId === ownerUserId
      && drawerRoutes.some((route) => route.id === parsed.route)
    ) {
      return parsed.route as RouteId;
    }
  } catch {
    return null;
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
    };
  }
  return null;
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
  const session = linkedSessionId
    ? sessions.find((candidate) => candidate.sessionId === linkedSessionId) ?? null
    : [...sessions].sort(compareSessions)[0] ?? null;
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.displayName ?? workspace.repo.name,
    repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
    branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
    targetId: session?.targetId ?? workspace.targetId ?? null,
    workspaceRuntimeId: session?.workspaceId ?? workspace.anyharnessWorkspaceId ?? null,
    sessionId: session?.sessionId ?? linkedSessionId,
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

interface DrawerProps {
  activeRoute: RouteId;
  account: AccountSummary;
  onNavigate: (route: RouteId) => void;
  onClose: () => void;
  onSignOut: () => void;
}

function Drawer({ activeRoute, account, onNavigate, onClose, onSignOut }: DrawerProps) {
  return (
    <View style={styles.drawerLayer}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close navigation"
        onPress={onClose}
        style={styles.scrim}
      />
      <View style={styles.drawer}>
        <View style={styles.brand}>
          <MobileProliferateMark size={20} />
          <Text style={styles.wordmark}>Proliferate</Text>
        </View>

        <View style={styles.drawerNav}>
          {drawerRoutes.map((item) => {
            const active = item.id === activeRoute;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onNavigate(item.id)}
                style={({ pressed }) => [
                  styles.drawerRow,
                  active && styles.drawerRowActive,
                  pressed && styles.drawerRowPressed,
                ]}
              >
                <MobileIcon
                  name={item.icon}
                  size={19}
                  color={active ? colors.fg : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.drawerRowText,
                    active && styles.drawerRowTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.account}>
          <View style={styles.accountAvatar}>
            <Text style={styles.accountAvatarText}>{account.initials}</Text>
          </View>
          <View style={styles.accountText}>
            <Text style={styles.accountName} numberOfLines={1}>
              {account.name}
            </Text>
            <Text style={styles.accountHandle} numberOfLines={1}>
              {account.handle}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={onSignOut}
            style={({ pressed }) => [styles.accountAction, pressed && styles.pressed]}
          >
            <MobileIcon name="log-out" size={17} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>
    </View>
  );
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
  fab: {
    position: "absolute",
    right: 18,
    bottom: 26,
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    backgroundColor: colors.fg,
    ...shadow.floating,
  },
  drawerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    flexDirection: "row",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayStrong,
  },
  drawer: {
    width: 296,
    height: "100%",
    paddingTop: 64,
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[4],
    backgroundColor: colors.sidebar,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.sidebarBorder,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[2],
    marginBottom: spacing[4],
  },
  wordmark: {
    color: colors.fg,
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  drawerNav: {
    flex: 1,
    gap: 2,
  },
  drawerRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
  },
  drawerRowActive: {
    backgroundColor: colors.sidebarAccent,
  },
  drawerRowPressed: {
    backgroundColor: colors.accent,
    opacity: 0.85,
  },
  drawerRowText: {
    color: colors.sidebarForeground,
    fontSize: 15,
    fontWeight: "500",
  },
  drawerRowTextActive: {
    color: colors.fg,
    fontWeight: "600",
  },
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingTop: spacing[3],
    paddingHorizontal: spacing[1],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.sidebarBorder,
  },
  accountAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.infoSubtle,
  },
  accountAvatarText: {
    color: colors.info,
    fontSize: 11.5,
    fontWeight: "700",
  },
  accountText: {
    flex: 1,
    minWidth: 0,
  },
  accountName: {
    color: colors.fg,
    fontSize: 13.5,
    fontWeight: "600",
  },
  accountHandle: {
    color: colors.faint,
    fontSize: 11.5,
    marginTop: 1,
  },
  accountAction: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  pressed: {
    opacity: 0.72,
  },
});
