import { Pressable, StyleSheet, Text, View } from "react-native";

import { mobileIconForRuntimeLocation, mobileIconForWorkSourceKind } from "../../lib/domain/work/mobile-work-presentation";
import type { MobileWorkItem } from "../../hooks/work/derived/use-mobile-work-inventory";
import { MobileIcon } from "../primitives/MobileIcon";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileWorkspaceCardProps {
  item: MobileWorkItem;
  compact?: boolean;
  claiming?: boolean;
  onPress: () => void;
  onClaim?: () => void;
}

export function MobileWorkspaceCard({
  item,
  compact = false,
  claiming = false,
  onPress,
  onClaim,
}: MobileWorkspaceCardProps) {
  const detailText = workspaceDetailText(item);
  const blocked = item.view.status === "blocked" || item.view.status === "error";
  const active = item.view.status === "active" || item.view.status === "running";
  const unclaimed = item.view.unclaimed;
  const canClaim = Boolean(onClaim) && unclaimed;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        compact && styles.cardCompact,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.iconTile, compact && styles.iconTileCompact]}>
          <MobileIcon
            name={mobileIconForWorkSourceKind(item.view.sourceKind)}
            size={compact ? 18 : 21}
            color={item.view.sourceKind === "slack" ? colors.success : colors.fg}
          />
          <View
            style={[
              styles.stateDot,
              active && styles.stateDotActive,
              blocked && styles.stateDotBlocked,
              unclaimed && styles.stateDotUnclaimed,
            ]}
          />
        </View>
        <View style={styles.cardTitleBlock}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, compact && styles.cardTitleCompact]} numberOfLines={1}>
              {item.view.title}
            </Text>
            <Text style={styles.cardTime}>{item.view.lastActivityLabel}</Text>
          </View>
          <View style={styles.cardMetaRow}>
            <MobileIcon
              name={mobileIconForRuntimeLocation(item.view.runtimeLocation)}
              size={13}
              color={colors.faint}
            />
            <Text style={styles.cardMeta} numberOfLines={1}>
              {item.view.repoLabel} · {item.view.branchLabel}
            </Text>
          </View>
        </View>
      </View>
      {detailText && !compact ? (
        <View style={styles.promptBlock}>
          <Text style={styles.promptText} numberOfLines={2}>
            {detailText}
          </Text>
        </View>
      ) : null}
      {canClaim ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Claim workspace"
          accessibilityState={{ disabled: claiming }}
          disabled={claiming}
          onPress={onClaim}
          style={({ pressed }) => [
            styles.claimButton,
            claiming && styles.claimButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.claimButtonText}>{claiming ? "Claiming" : "Claim workspace"}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function workspaceDetailText(item: MobileWorkItem): string | null {
  if (item.view.activityPreview) {
    return item.view.activityPreview;
  }
  if (item.view.unclaimed) {
    return "Unclaimed workspace";
  }
  if (item.view.commandability !== "commandable") {
    return item.view.commandabilityLabel;
  }
  return null;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  cardCompact: {
    borderRadius: 20,
    paddingVertical: spacing[2],
  },
  cardPressed: {
    opacity: 0.82,
    backgroundColor: colors.accent,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  iconTile: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  iconTileCompact: {
    width: 36,
    height: 36,
  },
  stateDot: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.borderHeavy,
  },
  stateDotActive: {
    backgroundColor: colors.info,
  },
  stateDotBlocked: {
    backgroundColor: colors.destructive,
  },
  stateDotUnclaimed: {
    backgroundColor: colors.success,
  },
  cardTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.fg,
    fontSize: 16,
    fontWeight: "600",
  },
  cardTitleCompact: {
    fontSize: 15,
  },
  cardTime: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "500",
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardMeta: {
    flex: 1,
    minWidth: 0,
    color: colors.faint,
    fontSize: 13.5,
    lineHeight: 18,
  },
  promptBlock: {
    borderRadius: 18,
    backgroundColor: colors.background,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  promptText: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
  },
  claimButton: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.fg,
    paddingHorizontal: spacing[4],
  },
  claimButtonDisabled: {
    opacity: 0.62,
  },
  claimButtonText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.7,
  },
});
