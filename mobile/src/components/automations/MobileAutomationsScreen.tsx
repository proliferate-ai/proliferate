import { StyleSheet, Text, View } from "react-native";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileListRow } from "../primitives/MobileListRow";
import { MobileScreen } from "../primitives/MobileLayout";
import { MobileStatusDot } from "../primitives/MobileStatusDot";
import { automations } from "../../lib/fixtures/mobile-fixtures";
import { colors, spacing } from "../../styles/tokens";

export function MobileAutomationsScreen() {
  return (
    <MobileScreen contentStyle={styles.screenContent}>
      <View style={styles.list}>
        {automations.map((automation) => {
          const enabled = automation.status === "enabled";
          return (
            <MobileListRow
              key={automation.id}
              leading={<MobileStatusDot status={enabled ? "running" : "paused"} size={8} />}
              title={automation.name}
              subtitle={automation.detail}
              trailing={
                <View style={styles.scheduleMeta}>
                  <MobileIcon name="calendar-clock" size={12} color={colors.faint} />
                  <Text style={styles.scheduleText}>{enabled ? "On" : "Paused"}</Text>
                </View>
              }
            />
          );
        })}
      </View>

      <Text style={styles.footnote}>
        Desktop runs more automation kinds — anything that needs local compute,
        browser, or computer use.
      </Text>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  scheduleMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scheduleText: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "500",
  },
  footnote: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    color: colors.faint,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
});
