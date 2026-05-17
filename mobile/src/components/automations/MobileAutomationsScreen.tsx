import { ScrollView, StyleSheet, Text, View } from "react-native";

import { MobileButton } from "../primitives/MobileButton";
import { MobileGlyph } from "../primitives/MobileGlyph";
import { automations } from "../../lib/fixtures/mobile-fixtures";
import { colors, radius, text } from "../../styles/tokens";

export function MobileAutomationsScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.stack}>
        <View>
          <Text style={text.eyebrow}>Automations</Text>
          <Text style={styles.title}>Scheduled cloud work</Text>
        </View>

        {automations.map((automation) => (
          <View key={automation.id} style={styles.card}>
            <MobileGlyph tone={automation.status === "enabled" ? "success" : "muted"}>A</MobileGlyph>
            <View style={styles.cardBody}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{automation.name}</Text>
                <Text style={styles.status}>{automation.status}</Text>
              </View>
              <Text style={text.caption}>{automation.detail}</Text>
            </View>
          </View>
        ))}

        <MobileButton label="New automation" variant="secondary" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 96,
  },
  stack: {
    gap: 12,
  },
  title: {
    ...text.title,
    marginTop: 8,
  },
  card: {
    flexDirection: "row",
    gap: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  cardBody: {
    minWidth: 0,
    flex: 1,
    gap: 4,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    minWidth: 0,
    flex: 1,
    color: colors.fg,
    fontSize: 15,
    fontWeight: "700",
  },
  status: {
    color: colors.green,
    fontSize: 12,
    fontWeight: "700",
  },
});
