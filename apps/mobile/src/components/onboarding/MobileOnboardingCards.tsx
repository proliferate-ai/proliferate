import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "../../styles/tokens";
import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";

export function MobileOnboardingValueCard() {
  return (
    <View style={styles.card}>
      <View style={styles.iconHero}>
        <MobileIcon name="cloud" size={36} color={colors.fg} />
      </View>
      <Text style={styles.cardTitle}>Use Proliferate from anywhere.</Text>
      <Text style={styles.cardBody}>
        Start a chat on mobile, continue it on web, finish on desktop. Sessions live on the cloud — pick up wherever you left off.
      </Text>
    </View>
  );
}

export function MobileOnboardingAgentsCard() {
  const agents: { name: string; icon: MobileIconName }[] = [
    { name: "Claude Code", icon: "claude" },
    { name: "Codex", icon: "openai" },
    { name: "Gemini", icon: "gemini" },
    { name: "OpenCode", icon: "sparkles" },
    { name: "Cursor", icon: "sparkles" },
  ];
  return (
    <View style={styles.card}>
      <View style={styles.iconHero}>
        <MobileIcon name="sparkles" size={36} color={colors.fg} />
      </View>
      <Text style={styles.cardTitle}>Bring any agent.</Text>
      <Text style={styles.cardBody}>
        Use Claude Code, Codex, Gemini, OpenCode, or Cursor. Switch per chat. Same workspace, same files.
      </Text>
      <View style={styles.agentGrid}>
        {agents.map((agent) => (
          <View key={agent.name} style={styles.agentChip}>
            <MobileIcon name={agent.icon} size={16} color={colors.fg} />
            <Text style={styles.agentChipText}>{agent.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function MobileOnboardingCreditsCard() {
  return (
    <View style={styles.card}>
      <View style={styles.iconHero}>
        <MobileIcon name="sparkles" size={36} color={colors.fg} />
      </View>
      <Text style={styles.cardTitle}>$5 in free credits.</Text>
      <Text style={styles.cardBody}>
        To get you started. After that you can bring your own API keys, configured from desktop or an org-wide env var.
      </Text>
    </View>
  );
}

export function MobileOnboardingIconHero({
  icon,
  size = 32,
}: {
  icon: MobileIconName;
  size?: number;
}) {
  return (
    <View style={styles.iconHero}>
      <MobileIcon name={icon} size={size} color={colors.fg} />
    </View>
  );
}

export const mobileOnboardingCardTextStyles = {
  title: {
    color: colors.fg,
    fontSize: 24,
    fontWeight: "600",
    lineHeight: 30,
    textAlign: "center",
  },
  body: {
    color: colors.mutedForeground,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    paddingHorizontal: spacing[2],
  },
} as const;

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[2],
  },
  iconHero: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: spacing[2],
  },
  cardTitle: mobileOnboardingCardTextStyles.title,
  cardBody: mobileOnboardingCardTextStyles.body,
  agentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing[2],
    marginTop: spacing[4],
  },
  agentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
  },
  agentChipText: {
    color: colors.fg,
    fontSize: 13,
    fontWeight: "500",
  },
});
