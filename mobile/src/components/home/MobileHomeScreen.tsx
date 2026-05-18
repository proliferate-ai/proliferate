import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MobileButton } from "../primitives/MobileButton";
import { MobileGlyph } from "../primitives/MobileGlyph";
import {
  MobileCard,
  MobileScreen,
  MobileScreenHeader,
  MobileStack,
} from "../primitives/MobileLayout";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { chats } from "../../lib/fixtures/mobile-fixtures";
import { colors, radius, spacing, text } from "../../styles/tokens";

const modes = ["Dispatch", "Shared chat", "Personal cloud"] as const;
const modeCopy: Record<(typeof modes)[number], string> = {
  Dispatch: "Send a lightweight remote task from your phone.",
  "Shared chat": "Start claimable team work in the shared sandbox.",
  "Personal cloud": "Run a personal cloud session with your configured tools.",
};

interface MobileHomeScreenProps {
  onOpenSessions: () => void;
}

export function MobileHomeScreen({ onOpenSessions }: MobileHomeScreenProps) {
  const [mode, setMode] = useState<(typeof modes)[number]>("Dispatch");

  return (
    <MobileScreen>
      <MobileStack>
        <MobileScreenHeader
          eyebrow="New chat"
          title="Start work from anywhere"
          description="Pick the run shape first, then send the task."
        />

        <View style={styles.modeList}>
          {modes.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              onPress={() => setMode(item)}
              style={[styles.modeCard, mode === item && styles.modeCardActive]}
            >
              <MobileGlyph tone={mode === item ? "info" : "muted"}>
                {item.slice(0, 1)}
              </MobileGlyph>
              <View style={styles.modeText}>
                <Text style={styles.modeTitle}>{item}</Text>
                <Text style={text.caption}>{modeCopy[item]}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <MobileCard style={styles.composer}>
          <MobileTextInput multiline placeholder="Ask Proliferate to work in your cloud sandbox" />
          <MobileButton label={`Start ${mode.toLowerCase()}`} variant="secondary" />
        </MobileCard>

        <MobileButton
          label={`${chats.length} sessions`}
          variant="secondary"
          onPress={onOpenSessions}
          leading={<Text style={styles.buttonGlyph}>S</Text>}
        />
      </MobileStack>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  modeList: {
    gap: spacing[2],
  },
  modeCard: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing[3],
  },
  modeCardActive: {
    borderColor: colors.borderHeavy,
    backgroundColor: colors.accent,
  },
  modeText: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  modeTitle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "700",
  },
  composer: {
    gap: 12,
  },
  buttonGlyph: {
    color: colors.fg,
    fontSize: 12,
    fontWeight: "800",
  },
});
