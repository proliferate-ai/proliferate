import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  drawerRoutes,
  routeTitle,
  type MobileCloudChat,
  type RouteId,
} from "../../navigation/navigation-model";
import { useMobileAuth } from "../../providers/MobileAuthProvider";
import { colors, radius, shadow, spacing } from "../../styles/tokens";

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
  const linkedWorkspace = useCloudWorkspaceSnapshot(
    linkedWorkspaceId,
    authState === "active" && linkedWorkspaceId !== null,
  );

  const subtitle = useMemo(() => routeSubtitle(route), [route]);
  const account = useMemo(() => accountSummary(user), [user]);
  const telemetryScreen = selectedChat ? "chat" : route;

  useMobileScreenTelemetry(authState, telemetryScreen);
  const canRecordAuthenticatedActivity = authState === "active" || authState === "needs_github";
  useMobileClientDailyActivity({
    accessToken: canRecordAuthenticatedActivity ? accessToken : null,
    actorStorageKey: user?.id ?? null,
    routeOrScreen: authState === "needs_github" ? "connect_github" : telemetryScreen,
    viewingChat: authState === "active" && selectedChat !== null,
  });
  const applyWorkspaceLink = useCallback((url: string | null) => {
    const workspaceId = workspaceIdFromUrl(url);
    if (!workspaceId) {
      return;
    }
    setLinkedWorkspaceId(workspaceId);
    setRoute("workspaces");
    setSelectedChat(null);
    setDrawerOpen(false);
  }, []);

  useEffect(() => {
    let active = true;
    void Linking.getInitialURL().then((url) => {
      if (active) {
        applyWorkspaceLink(url);
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
    if (!linkedWorkspaceId || !linkedWorkspace.data) {
      return;
    }
    const chat = linkedChatForWorkspace(linkedWorkspace.data.workspace, linkedWorkspace.data.sessions);
    if (chat) {
      setSelectedChat(chat);
    } else {
      setRoute("workspaces");
    }
    setLinkedWorkspaceId(null);
  }, [linkedWorkspace.data, linkedWorkspaceId]);

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

  function handleSignOut() {
    setRoute("home");
    setDrawerOpen(false);
    setSelectedChat(null);
    signOut();
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
          onSignOut={handleSignOut}
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
        <MobileChatScreen chat={selectedChat} onBack={() => setSelectedChat(null)} />
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
              <MobileHomeScreen onOpenChat={openChat} />
            ) : route === "workspaces" ? (
              <MobileWorkspacesScreen onOpenChat={openChat} />
            ) : route === "sessions" ? (
              <MobileSessionsScreen onOpenChat={openChat} />
            ) : route === "automations" ? (
              <MobileAutomationsScreen />
            ) : (
              <MobileSettingsScreen account={account} onSignOut={handleSignOut} />
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
          onSignOut={handleSignOut}
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

function workspaceIdFromUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }
  const match = url.match(
    /^(?:proliferate:\/\/workspaces\/|https:\/\/app\.proliferate\.ai\/workspaces\/)([^/?#]+)/u,
  );
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function linkedChatForWorkspace(
  workspace: CloudWorkspaceDetail,
  sessions: readonly CloudSessionProjection[],
): MobileCloudChat | null {
  const session = [...sessions].sort((left, right) =>
    (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0)
  )[0];
  if (!session) {
    return null;
  }
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
