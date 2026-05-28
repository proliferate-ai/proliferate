import { useEffect } from "react";
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useMobileWorkInventory } from "../../../hooks/work/derived/use-mobile-work-inventory";
import {
  allWorkRoute,
  drawerRoutes,
  type MobileCloudChat,
  type RouteId,
} from "../../../navigation/navigation-model";
import { colors, radius, spacing } from "../../../styles/tokens";
import { MobileIcon, type MobileIconName } from "../../primitives/MobileIcon";
import { MobileProliferateMark } from "../../primitives/MobileProliferateMark";

export interface MobileDrawerAccountSummary {
  initials: string;
  name: string;
  handle: string;
}

interface MobileDrawerProps {
  activeRoute: RouteId | null;
  account: MobileDrawerAccountSummary;
  onNavigate: (route: RouteId) => void;
  onOpenChat: (chat: MobileCloudChat) => void;
  onNewChat: () => void;
  onClose: () => void;
}


export function MobileDrawer({
  activeRoute,
  account: _account,
  onNavigate,
  onOpenChat,
  onNewChat,
  onClose: _onClose,
}: MobileDrawerProps) {
  const inventory = useMobileWorkInventory();

  useEffect(() => {
    Keyboard.dismiss();
  }, []);

  function navigate(route: RouteId) {
    onNavigate(route);
  }

  return (
    <View style={styles.drawer}>
        <View style={styles.profileHeader}>
          <View style={styles.profileBrand}>
            <MobileProliferateMark size={19} />
            <Text style={styles.wordmark}>Proliferate</Text>
          </View>
        </View>

        <View style={styles.primaryNav}>
          {drawerRoutes.map((item) => (
            <DrawerRouteRow
              key={item.id}
              active={item.id === activeRoute}
              icon={item.icon}
              label={item.label}
              onPress={() => navigate(item.id)}
            />
          ))}
        </View>

        <View style={styles.recentSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Recents</Text>
          </View>
          <ScrollView
            style={styles.recentList}
            contentContainerStyle={styles.recentListContent}
            showsVerticalScrollIndicator={false}
          >
            {inventory.isLoading ? (
              <Text style={styles.recentEmpty}>Loading...</Text>
            ) : inventory.recentItems.length === 0 ? (
              <Text style={styles.recentEmpty}>No recent work yet</Text>
            ) : (
              <>
                {inventory.recentItems.map((item) => (
                  <Pressable
                    key={item.view.id}
                    accessibilityRole="button"
                    onPress={() => onOpenChat(item.chat)}
                    style={({ pressed }) => [styles.recentRow, pressed && styles.drawerRowPressed]}
                  >
                    <Text style={styles.recentTitle} numberOfLines={1}>{item.view.title}</Text>
                  </Pressable>
                ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="All workspaces"
                  onPress={() => navigate(allWorkRoute.id)}
                  style={({ pressed }) => [styles.recentRow, pressed && styles.drawerRowPressed]}
                >
                  <Text style={styles.allWorkspacesTitle} numberOfLines={1}>All workspaces</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>

        <View style={styles.drawerBottom}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New chat"
            onPress={() => {
              onNewChat();
            }}
            style={({ pressed }) => [styles.newChat, pressed && styles.newChatPressed]}
          >
            <MobileIcon name="plus" size={17} color={colors.background} />
            <Text style={styles.newChatText}>New chat</Text>
          </Pressable>
        </View>
    </View>
  );
}

function DrawerRouteRow({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: MobileIconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.drawerRow,
        active && styles.drawerRowActive,
        pressed && styles.drawerRowPressed,
      ]}
    >
      <MobileIcon
        name={icon}
        size={19}
        color={active ? colors.fg : colors.mutedForeground}
      />
      <Text
        style={[
          styles.drawerRowText,
          active && styles.drawerRowTextActive,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  drawer: {
    flex: 1,
    paddingTop: Platform.OS === "web" ? 60 : 80,
    paddingHorizontal: spacing[2],
    paddingBottom: Platform.OS === "web" ? 20 : spacing[4],
    backgroundColor: colors.sidebar,
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing[4],
    marginBottom: spacing[4],
  },
  profileBrand: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  wordmark: {
    color: colors.fg,
    fontSize: 18,
    fontWeight: "600",
  },
  primaryNav: {
    gap: 2,
  },
  drawerRow: {
    minHeight: 39,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: 20,
    paddingHorizontal: spacing[4],
  },
  drawerRowActive: {
    backgroundColor: colors.sidebarAccent,
  },
  drawerRowPressed: {
    backgroundColor: colors.accent,
    opacity: 0.85,
  },
  drawerRowText: {
    flex: 1,
    minWidth: 0,
    color: colors.sidebarForeground,
    fontSize: 14,
    fontWeight: "500",
  },
  drawerRowTextActive: {
    color: colors.fg,
    fontWeight: "600",
  },
  recentSection: {
    flex: 1,
    marginTop: spacing[3],
    minHeight: 0,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
  },
  sectionLabel: {
    color: colors.sidebarMutedForeground,
    fontSize: 13,
    fontWeight: "500",
  },
  recentList: {
    flex: 1,
  },
  recentListContent: {
    gap: 1,
  },
  recentEmpty: {
    color: colors.faint,
    fontSize: 13.5,
    lineHeight: 18,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  recentRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 17,
    paddingHorizontal: spacing[4],
  },
  recentTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.fg,
    fontSize: 14,
    fontWeight: "500",
  },
  allWorkspacesTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.sidebarMutedForeground,
    fontSize: 14,
    fontWeight: "500",
  },
  drawerBottom: {
    paddingTop: spacing[2],
  },
  newChat: {
    minHeight: 44,
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.fg,
    paddingHorizontal: spacing[4],
  },
  newChatPressed: {
    opacity: 0.82,
  },
  newChatText: {
    color: colors.background,
    fontSize: 14.5,
    fontWeight: "600",
  },
});
