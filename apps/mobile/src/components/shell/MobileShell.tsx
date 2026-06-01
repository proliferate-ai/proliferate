import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCloudWorkspaceSnapshot } from "@proliferate/cloud-sdk-react";

import { MobileAuthScreen } from "../auth/MobileAuthScreen";
import { MobileConnectGitHubScreen } from "../auth/MobileConnectGitHubScreen";
import { MobileOnboardingScreen } from "../onboarding/MobileOnboardingScreen";
import { MobileAutomationsScreen } from "../automations/MobileAutomationsScreen";
import { MobileChatScreen } from "../chat/MobileChatScreen";
import { MobileHomeScreen } from "../home/MobileHomeScreen";
import { MobileSettingsScreen } from "../settings/MobileSettingsScreen";
import { MobileDrawer } from "./drawer/MobileDrawer";
import { MobileShellWithDrawer } from "./screen/MobileShellWithDrawer";
import { MobileTopBar } from "../primitives/MobileTopBar";
import { MobileWorkspacesScreen } from "../work/MobileAllWorkScreen";
import { useMobileOnboardingStatus } from "../../hooks/shell/lifecycle/use-mobile-onboarding-status";
import { useMobileClientDailyActivity } from "../../hooks/telemetry/lifecycle/use-mobile-client-daily-activity";
import { useMobileScreenTelemetry } from "../../hooks/telemetry/lifecycle/use-mobile-screen-telemetry";
import {
  clearMobileShellNavigation,
  persistMobileShellNavigation,
  restoreMobileShellNavigation,
} from "../../lib/access/native/mobile-shell-navigation-storage";
import {
  buildMobileShellAccountSummary,
  mobileLinkedChatForWorkspace,
  mobileShellRouteSubtitle,
  mobileWorkspaceLinkFromUrl,
} from "../../lib/domain/shell/mobile-shell-navigation";
import { routeTitle, type MobileCloudChat, type RouteId } from "../../navigation/navigation-model";
import { useMobileAuth } from "../../providers/MobileAuthProvider";
import { colors, spacing } from "../../styles/tokens";

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
  const [linkedWorkspaceId, setLinkedWorkspaceId] = useState<string | null>(null);
  const [linkedWorkspaceSessionId, setLinkedWorkspaceSessionId] = useState<string | null>(null);
  const [initialLinkChecked, setInitialLinkChecked] = useState(false);
  const [navigationRestored, setNavigationRestored] = useState(false);
  const initialLinkAppliedRef = useRef(false);
  const linkedWorkspace = useCloudWorkspaceSnapshot(
    linkedWorkspaceId,
    authState === "active" && linkedWorkspaceId !== null,
  );

  const { completeOnboarding, onboardingStatus } = useMobileOnboardingStatus(authState);
  const subtitle = useMemo(() => mobileShellRouteSubtitle(route), [route]);
  const account = useMemo(() => buildMobileShellAccountSummary(user), [user]);
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
    const link = mobileWorkspaceLinkFromUrl(url);
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
    void restoreMobileShellNavigation(ownerUserId)
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
    void persistMobileShellNavigation(ownerUserId, route, selectedChat);
  }, [authState, navigationRestored, ownerUserId, route, selectedChat]);

  useEffect(() => {
    if (!linkedWorkspaceId || !linkedWorkspace.data) {
      return;
    }
    const chat = mobileLinkedChatForWorkspace(
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
    await clearMobileShellNavigation(ownerUserId).catch(() => undefined);
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

      <MobileShellWithDrawer
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
      </MobileShellWithDrawer>

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
  rootShell: {
    flex: 1,
    backgroundColor: colors.sidebar,
  },
});
