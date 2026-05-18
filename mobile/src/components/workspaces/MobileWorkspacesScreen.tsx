import { ScrollView, StyleSheet, Text, View } from "react-native";

import { MobileGlyph } from "../primitives/MobileGlyph";
import { workspaces } from "../../lib/fixtures/mobile-fixtures";
import { colors, radius, text } from "../../styles/tokens";

export function MobileWorkspacesScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.stack}>
        <View>
          <Text style={text.eyebrow}>Workspaces</Text>
          <Text style={styles.title}>Cloud sandboxes</Text>
        </View>

        {workspaces.map((workspace) => (
          <View key={workspace.id} style={styles.card}>
            <MobileGlyph tone={workspace.kind === "shared" ? "info" : "muted"}>
              {workspace.kind === "shared" ? "T" : "P"}
            </MobileGlyph>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{workspace.name}</Text>
              <Text style={text.caption}>{workspace.repoLabel}</Text>
              <Text style={styles.branch}>{workspace.branchLabel}</Text>
            </View>
          </View>
        ))}
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
  branch: {
    color: colors.faint,
    fontSize: 12,
  },
});
