import { StyleSheet, Text, View } from "react-native";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileListRow } from "../primitives/MobileListRow";
import {
  MobileScreen,
  MobileStatusPill,
} from "../primitives/MobileLayout";
import { automations } from "../../lib/fixtures/mobile-fixtures";
import { colors, radius, spacing } from "../../styles/tokens";

export function MobileAutomationsScreen() {
  return (
    <MobileScreen contentStyle={styles.screenContent}>
      <View style={styles.note}>
        <MobileIcon name="cloud" size={15} color={colors.faint} />
        <Text style={styles.noteText}>
          Desktop runs more automation kinds — anything that needs local
          compute, browser, or computer use.
        </Text>
      </View>

      <View style={styles.list}>
        {automations.map((automation) => {
          const enabled = automation.status === "enabled";
          return (
            <MobileListRow
              key={automation.id}
              leading={
                <View style={styles.icon}>
                  <MobileIcon name="automations" size={17} color={colors.info} />
                </View>
              }
              title={automation.name}
              subtitle={automation.detail}
              trailing={
                <MobileStatusPill tone={enabled ? "success" : "muted"}>
                  {enabled ? "On" : "Paused"}
                </MobileStatusPill>
              }
            />
          );
        })}
      </View>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  note: {
    marginHorizontal: spacing[4],
    marginTop: spacing[3],
    marginBottom: spacing[2],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  noteText: {
    flex: 1,
    color: colors.mutedForeground,
    fontSize: 12.5,
    lineHeight: 17,
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  icon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.infoSubtle,
  },
});
