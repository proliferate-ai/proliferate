import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ProductChat } from "@proliferate/product-model/chats/model";

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
import { drawerRoutes, routeTitle, type RouteId } from "../../navigation/navigation-model";
import { useMobileAuth } from "../../providers/MobileAuthProvider";
import { colors, radius, shadow, spacing } from "../../styles/tokens";

const ACCOUNT = {
  initials: "PH",
  name: "Pablo Hansen",
  handle: "pablo@proliferate.ai",
};

export function MobileShell() {
  const { authState, signInWithApple, signInWithGitHub, signOut } = useMobileAuth();
  const [route, setRoute] = useState<RouteId>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedChat, setSelectedChat] = useState<ProductChat | null>(null);

  const subtitle = useMemo(() => routeSubtitle(route), [route]);

  function navigate(nextRoute: RouteId) {
    setRoute(nextRoute);
    setSelectedChat(null);
    setDrawerOpen(false);
  }

  function openChat(chat: ProductChat) {
    setSelectedChat(chat);
    setDrawerOpen(false);
  }

  if (authState === "signed_out") {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <MobileAuthScreen onApple={signInWithApple} onGitHub={signInWithGitHub} />
      </SafeAreaView>
    );
  }

  if (authState === "needs_github") {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <MobileConnectGitHubScreen
          onConnect={signInWithGitHub}
          onSignOut={signOut}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
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
              <MobileHomeScreen onOpenSessions={() => navigate("sessions")} />
            ) : route === "workspaces" ? (
              <MobileWorkspacesScreen />
            ) : route === "sessions" ? (
              <MobileSessionsScreen onOpenChat={openChat} />
            ) : route === "automations" ? (
              <MobileAutomationsScreen />
            ) : (
              <MobileSettingsScreen onSignOut={signOut} />
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
          onSignOut={signOut}
        />
      )}
    </SafeAreaView>
  );
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

interface DrawerProps {
  activeRoute: RouteId;
  onNavigate: (route: RouteId) => void;
  onClose: () => void;
  onSignOut: () => void;
}

function Drawer({ activeRoute, onNavigate, onClose, onSignOut }: DrawerProps) {
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
            <Text style={styles.accountAvatarText}>{ACCOUNT.initials}</Text>
          </View>
          <View style={styles.accountText}>
            <Text style={styles.accountName} numberOfLines={1}>
              {ACCOUNT.name}
            </Text>
            <Text style={styles.accountHandle} numberOfLines={1}>
              {ACCOUNT.handle}
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
