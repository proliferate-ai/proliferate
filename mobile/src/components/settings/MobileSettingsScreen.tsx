import { ScrollView, StyleSheet, Text, View } from "react-native";

import { MobileGlyph } from "../primitives/MobileGlyph";
import { colors, radius, text } from "../../styles/tokens";

export function MobileSettingsScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.stack}>
        <View>
          <Text style={text.eyebrow}>Settings</Text>
          <Text style={styles.title}>Account and cloud</Text>
        </View>

        <View style={styles.card}>
          <MobileGlyph tone="info">G</MobileGlyph>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>GitHub connected</Text>
            <Text style={text.caption}>Cloud workspaces require the product account to have GitHub attached.</Text>
          </View>
        </View>

        <View style={styles.card}>
          <MobileGlyph tone="muted">M</MobileGlyph>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>MCPs and skills</Text>
            <Text style={text.caption}>Public team tools are configured from Web or Desktop.</Text>
          </View>
        </View>

        <View style={styles.card}>
          <MobileGlyph tone="success">T</MobileGlyph>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>TestFlight build</Text>
            <Text style={text.caption}>Bundle id ai.proliferate.mobile is ready for iOS distribution.</Text>
          </View>
        </View>
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
  cardTitle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "700",
  },
});
