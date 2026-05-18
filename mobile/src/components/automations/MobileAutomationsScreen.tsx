import { StyleSheet, Text, View } from "react-native";

import { MobileButton } from "../primitives/MobileButton";
import { MobileGlyph } from "../primitives/MobileGlyph";
import {
  MobileCard,
  MobileCardTitle,
  MobileScreen,
  MobileScreenHeader,
  MobileStack,
  MobileStatusPill,
} from "../primitives/MobileLayout";
import { automations } from "../../lib/fixtures/mobile-fixtures";
import { spacing, text } from "../../styles/tokens";

export function MobileAutomationsScreen() {
  return (
    <MobileScreen>
      <MobileStack>
        <MobileScreenHeader eyebrow="Automations" title="Scheduled cloud work" />

        {automations.map((automation) => (
          <MobileCard key={automation.id} style={styles.card}>
            <MobileGlyph tone={automation.status === "enabled" ? "success" : "muted"}>A</MobileGlyph>
            <View style={styles.cardBody}>
              <View style={styles.rowBetween}>
                <MobileCardTitle>{automation.name}</MobileCardTitle>
                <MobileStatusPill tone={automation.status === "enabled" ? "success" : "muted"}>
                  {automation.status}
                </MobileStatusPill>
              </View>
              <Text style={text.caption}>{automation.detail}</Text>
            </View>
          </MobileCard>
        ))}

        <MobileButton label="New automation" variant="secondary" />
      </MobileStack>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: spacing[3],
  },
  cardBody: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1],
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    justifyContent: "space-between",
  },
});
