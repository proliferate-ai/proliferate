import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { MobileButton } from "../primitives/MobileButton";
import { MobileGlyph } from "../primitives/MobileGlyph";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { chats, workspaces } from "../../lib/fixtures/mobile-fixtures";
import { colors, radius, text } from "../../styles/tokens";

const modes = ["Dispatch", "Shared chat", "Personal cloud"] as const;

interface MobileHomeScreenProps {
  onOpenSessions: () => void;
}

export function MobileHomeScreen({ onOpenSessions }: MobileHomeScreenProps) {
  const [mode, setMode] = useState<(typeof modes)[number]>("Dispatch");

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.stack}>
        <View>
          <Text style={text.eyebrow}>New chat</Text>
          <Text style={styles.title}>Start work from anywhere.</Text>
        </View>

        <View style={styles.segmented}>
          {modes.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              onPress={() => setMode(item)}
              style={[styles.segment, mode === item && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, mode === item && styles.segmentTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.composer}>
          <MobileTextInput multiline placeholder="Ask Proliferate to work in your cloud sandbox" />
          <MobileButton label={`Start ${mode}`} />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Workspaces</Text>
          <Text style={styles.sectionMeta}>{workspaces.length}</Text>
        </View>
        {workspaces.map((workspace) => (
          <View key={workspace.id} style={styles.card}>
            <MobileGlyph tone={workspace.kind === "shared" ? "info" : "muted"}>
              {workspace.kind === "shared" ? "T" : "P"}
            </MobileGlyph>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{workspace.name}</Text>
              <Text style={text.caption}>{workspace.repoLabel}</Text>
            </View>
          </View>
        ))}

        <MobileButton
          label={`${chats.length} sessions`}
          variant="secondary"
          onPress={onOpenSessions}
          leading={<Text style={styles.buttonGlyph}>S</Text>}
        />
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
    gap: 14,
  },
  title: {
    ...text.title,
    marginTop: 8,
    fontSize: 30,
    lineHeight: 36,
  },
  segmented: {
    flexDirection: "row",
    padding: 4,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    paddingHorizontal: 6,
  },
  segmentActive: {
    backgroundColor: colors.accent,
  },
  segmentText: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  segmentTextActive: {
    color: colors.fg,
  },
  composer: {
    gap: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  sectionHeader: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "700",
  },
  sectionMeta: {
    color: colors.faint,
    fontSize: 12,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
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
  },
  cardTitle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "700",
  },
  buttonGlyph: {
    color: colors.fg,
    fontSize: 12,
    fontWeight: "800",
  },
});
