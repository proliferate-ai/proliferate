import { Pressable, StyleSheet, Text, View } from "react-native";

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
  activeRoute: RouteId;
  account: MobileDrawerAccountSummary;
  onNavigate: (route: RouteId) => void;
  onOpenChat: (chat: MobileCloudChat) => void;
  onClose: () => void;
  onSignOut: () => void;
}

export function MobileDrawer({
  activeRoute,
  account,
  onNavigate,
  onOpenChat,
  onClose,
  onSignOut,
}: MobileDrawerProps) {
  const inventory = useMobileWorkInventory();

  function navigate(route: RouteId) {
    onNavigate(route);
  }

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
            <Text style={styles.sectionLabel}>Recent work</Text>
            <Text style={styles.sectionCount}>{inventory.recentItems.length}</Text>
          </View>
          <View style={styles.recentList}>
            {inventory.isLoading ? (
              <Text style={styles.recentEmpty}>Loading...</Text>
            ) : inventory.recentItems.length === 0 ? (
              <Text style={styles.recentEmpty}>No recent work yet.</Text>
            ) : (
              inventory.recentItems.map((item) => (
                <Pressable
                  key={item.view.id}
                  accessibilityRole="button"
                  onPress={() => onOpenChat(item.chat)}
                  style={({ pressed }) => [styles.recentRow, pressed && styles.drawerRowPressed]}
                >
                  <MobileIcon
                    name={item.view.source === "slack" ? "slack" : item.view.source === "automation" ? "calendar-clock" : "sessions"}
                    size={16}
                    color={colors.mutedForeground}
                  />
                  <View style={styles.recentText}>
                    <Text style={styles.recentTitle} numberOfLines={1}>{item.view.title}</Text>
                    <Text style={styles.recentMeta} numberOfLines={1}>
                      {item.view.sourceLabel} - {item.view.lastActivityLabel}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        </View>

        <View style={styles.drawerBottom}>
          <DrawerRouteRow
            active={activeRoute === allWorkRoute.id}
            icon={allWorkRoute.icon}
            label={`${allWorkRoute.label}${inventory.items.length ? ` (${inventory.items.length})` : ""}`}
            onPress={() => navigate(allWorkRoute.id)}
          />

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
  primaryNav: {
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
    flex: 1,
    minWidth: 0,
    color: colors.sidebarForeground,
    fontSize: 15,
    fontWeight: "500",
  },
  drawerRowTextActive: {
    color: colors.fg,
    fontWeight: "600",
  },
  recentSection: {
    flex: 1,
    marginTop: spacing[5],
    minHeight: 0,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[2],
    paddingBottom: spacing[2],
  },
  sectionLabel: {
    color: colors.sidebarMutedForeground,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sectionCount: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "600",
  },
  recentList: {
    gap: 2,
  },
  recentEmpty: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
  },
  recentRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  recentText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  recentTitle: {
    color: colors.fg,
    fontSize: 13,
    fontWeight: "600",
  },
  recentMeta: {
    color: colors.faint,
    fontSize: 11,
  },
  drawerBottom: {
    gap: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.sidebarBorder,
  },
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[1],
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
