import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  MobileScreen,
  MobileScreenHeader,
  MobileSectionLabel,
  MobileStack,
} from "../primitives/MobileLayout";
import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { colors, radius, spacing } from "../../styles/tokens";

type Mode = "dispatch" | "shared" | "personal";

interface ModeMeta {
  id: Mode;
  title: string;
  description: string;
  icon: MobileIconName;
  cta: string;
  chip: string;
}

const MODES: ModeMeta[] = [
  {
    id: "dispatch",
    title: "Dispatch",
    description: "Lightweight remote task. No setup.",
    icon: "smartphone",
    cta: "Dispatch task",
    chip: "Mobile-first",
  },
  {
    id: "shared",
    title: "Shared chat",
    description: "Start claimable team work in the shared sandbox.",
    icon: "users",
    cta: "Start shared chat",
    chip: "Team",
  },
  {
    id: "personal",
    title: "Personal cloud",
    description: "Your repo, your tools, your model.",
    icon: "cloud",
    cta: "Start personal cloud",
    chip: "Personal",
  },
];

interface MobileHomeScreenProps {
  onOpenSessions: () => void;
}

export function MobileHomeScreen({ onOpenSessions }: MobileHomeScreenProps) {
  const [mode, setMode] = useState<Mode>("dispatch");
  const [draft, setDraft] = useState("");
  const meta = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <MobileScreen>
      <MobileStack gap={spacing[5]}>
        <MobileScreenHeader
          eyebrow="New chat"
          title="What should we run?"
          description="Pick a run shape, then send the task."
        />

        <View style={styles.modeGroup}>
          {MODES.map((item) => {
            const active = item.id === mode;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setMode(item.id)}
                style={({ pressed }) => [
                  styles.modeRow,
                  active && styles.modeRowActive,
                  pressed && styles.modeRowPressed,
                ]}
              >
                <View style={[styles.modeIcon, active && styles.modeIconActive]}>
                  <MobileIcon
                    name={item.icon}
                    size={18}
                    color={active ? colors.fg : colors.mutedForeground}
                  />
                </View>
                <View style={styles.modeText}>
                  <Text style={styles.modeTitle}>{item.title}</Text>
                  <Text style={styles.modeDescription}>{item.description}</Text>
                </View>
                <View style={styles.radio}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View>
          <MobileSectionLabel>Prompt</MobileSectionLabel>
          <View style={styles.composer}>
            <MobileTextInput
              multiline
              value={draft}
              onChangeText={setDraft}
              placeholder={composerPlaceholder(mode)}
              style={styles.composerInput}
            />
            <View style={styles.composerFooter}>
              {mode === "personal" ? (
                <View style={styles.context}>
                  <MobileIcon name="cloud" size={13} color={colors.faint} />
                  <Text style={styles.contextText} numberOfLines={1}>
                    Personal cloud sandbox
                  </Text>
                </View>
              ) : (
                <View style={styles.context}>
                  <Text style={styles.contextChip}>{meta.chip}</Text>
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={meta.cta}
                disabled={!draft.trim()}
                onPress={() => {
                  if (!draft.trim()) return;
                  setDraft("");
                  onOpenSessions();
                }}
                style={({ pressed }) => [
                  styles.send,
                  !draft.trim() && styles.sendDisabled,
                  pressed && styles.sendPressed,
                ]}
              >
                <MobileIcon
                  name="send"
                  size={16}
                  color={draft.trim() ? colors.background : colors.faint}
                />
              </Pressable>
            </View>
          </View>
        </View>
      </MobileStack>
    </MobileScreen>
  );
}

function composerPlaceholder(mode: Mode): string {
  switch (mode) {
    case "dispatch":
      return "Describe a quick remote task...";
    case "shared":
      return "Ask the shared sandbox to take this on...";
    case "personal":
      return "Ask Proliferate to work in your sandbox...";
  }
}

const styles = StyleSheet.create({
  modeGroup: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  modeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  modeRowActive: {
    backgroundColor: colors.accent,
  },
  modeRowPressed: {
    opacity: 0.85,
  },
  modeIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modeIconActive: {
    backgroundColor: colors.sidebar,
    borderColor: colors.borderHeavy,
  },
  modeText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  modeTitle: {
    color: colors.fg,
    fontSize: 14.5,
    fontWeight: "600",
  },
  modeDescription: {
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 17,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.4,
    borderColor: colors.borderHeavy,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.fg,
  },
  composer: {
    marginTop: spacing[2],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  composerInput: {
    minHeight: 96,
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
    fontSize: 15,
    lineHeight: 22,
  },
  composerFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  context: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  contextText: {
    color: colors.faint,
    fontSize: 12,
  },
  contextChip: {
    color: colors.faint,
    fontSize: 11.5,
    fontWeight: "600",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  send: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.fg,
  },
  sendDisabled: {
    backgroundColor: colors.accent,
  },
  sendPressed: {
    opacity: 0.85,
  },
});
