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
import { MobileGlyph } from "../primitives/MobileGlyph";
import { MobileProliferateMark } from "../primitives/MobileProliferateMark";
import { MobileSessionsScreen } from "../sessions/MobileSessionsScreen";
import { MobileSettingsScreen } from "../settings/MobileSettingsScreen";
import { MobileWorkspacesScreen } from "../workspaces/MobileWorkspacesScreen";
import { chats } from "../../lib/fixtures/mobile-fixtures";
import { drawerRoutes, routeTitle, type RouteId } from "../../navigation/navigation-model";
import { useMobileAuth } from "../../providers/MobileAuthProvider";
import { colors, radius, shadow, spacing } from "../../styles/tokens";

function MenuIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <View style={styles.closeIcon}>
        <View style={[styles.closeLine, styles.closeLineOne]} />
        <View style={[styles.closeLine, styles.closeLineTwo]} />
      </View>
    );
  }

  return (
    <View style={styles.menuIcon}>
      <View style={styles.menuLine} />
      <View style={styles.menuLine} />
      <View style={styles.menuLine} />
    </View>
  );
}

export function MobileShell() {
  const { authState, signInWithApple, signInWithGitHub, signOut } = useMobileAuth();
  const [route, setRoute] = useState<RouteId>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedChat, setSelectedChat] = useState<ProductChat | null>(chats[0] ?? null);
  const title = useMemo(() => (selectedChat ? selectedChat.title : routeTitle(route)), [route, selectedChat]);

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
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={drawerOpen ? "Close navigation" : "Open navigation"}
          onPress={() => setDrawerOpen((value) => !value)}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <MenuIcon open={drawerOpen} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.headerSubtitle}>
            {selectedChat ? "Session" : "Mobile cloud preview"}
          </Text>
        </View>
        {selectedChat ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to sessions"
            onPress={() => setSelectedChat(null)}
            style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
          >
            <Text style={styles.smallButtonText}>Back</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New chat"
            onPress={() => navigate("home")}
            style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
          >
            <Text style={styles.smallButtonText}>+</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.body}>
        {selectedChat ? (
          <MobileChatScreen chat={selectedChat} />
        ) : route === "home" ? (
          <MobileHomeScreen onOpenSessions={() => navigate("sessions")} />
        ) : route === "workspaces" ? (
          <MobileWorkspacesScreen />
        ) : route === "sessions" ? (
          <MobileSessionsScreen onOpenChat={openChat} />
        ) : route === "automations" ? (
          <MobileAutomationsScreen />
        ) : (
          <MobileSettingsScreen />
        )}
      </View>

      {!selectedChat && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New chat"
          onPress={() => navigate("home")}
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
        >
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      )}

      {drawerOpen && (
        <View style={styles.drawerLayer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
            onPress={() => setDrawerOpen(false)}
            style={styles.scrim}
          />
          <View style={styles.drawer}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}>
                <MobileProliferateMark size={18} />
              </View>
              <View>
                <Text style={styles.brandTitle}>Proliferate</Text>
                <Text style={styles.brandSubtitle}>Cloud mobile</Text>
              </View>
            </View>

            {drawerRoutes.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => navigate(item.id)}
                style={({ pressed }) => [
                  styles.drawerRow,
                  route === item.id && !selectedChat && styles.drawerRowActive,
                  pressed && styles.pressed,
                ]}
              >
                <MobileGlyph tone={route === item.id && !selectedChat ? "info" : "muted"}>{item.glyph}</MobileGlyph>
                <Text style={styles.drawerRowText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  menuIcon: {
    gap: 4,
  },
  menuLine: {
    width: 17,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.fg,
  },
  closeIcon: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  closeLine: {
    position: "absolute",
    width: 18,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.fg,
  },
  closeLineOne: {
    transform: [{ rotate: "45deg" }],
  },
  closeLineTwo: {
    transform: [{ rotate: "-45deg" }],
  },
  headerText: {
    minWidth: 0,
    flex: 1,
  },
  headerTitle: {
    color: colors.fg,
    fontSize: 16,
    fontWeight: "700",
  },
  headerSubtitle: {
    color: colors.faint,
    fontSize: 12,
    marginTop: 2,
  },
  smallButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  smallButtonText: {
    color: colors.fg,
    fontSize: 13,
    fontWeight: "800",
  },
  body: {
    flex: 1,
  },
  fab: {
    position: "absolute",
    right: 18,
    bottom: 26,
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 27,
    backgroundColor: colors.fg,
    ...shadow.floating,
  },
  fabText: {
    color: colors.bg,
    fontSize: 26,
    lineHeight: 28,
    fontWeight: "700",
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
    width: 298,
    height: "100%",
    paddingTop: 76,
    paddingHorizontal: 12,
    backgroundColor: colors.sidebar,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    marginBottom: 18,
  },
  brandMark: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  brandTitle: {
    color: colors.fg,
    fontSize: 17,
    fontWeight: "800",
  },
  brandSubtitle: {
    color: colors.faint,
    fontSize: 12,
    marginTop: 2,
  },
  drawerRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radius.lg,
    paddingHorizontal: 10,
  },
  drawerRowActive: {
    backgroundColor: colors.accent,
  },
  drawerRowText: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.72,
  },
});
