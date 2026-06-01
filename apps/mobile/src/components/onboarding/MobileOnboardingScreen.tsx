import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, spacing } from "../../styles/tokens";
import {
  MobileOnboardingAgentsCard,
  MobileOnboardingCreditsCard,
  MobileOnboardingValueCard,
} from "./MobileOnboardingCards";
import { MobileOnboardingRepoStep } from "./MobileOnboardingRepoStep";

interface MobileOnboardingScreenProps {
  onDone: () => void;
}

type Step = 0 | 1 | 2 | 3;

export function MobileOnboardingScreen({ onDone }: MobileOnboardingScreenProps) {
  const [step, setStep] = useState<Step>(0);

  function next() {
    if (step < 3) {
      setStep((s) => (s + 1) as Step);
    } else {
      onDone();
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "right", "bottom", "left"]}>
      <View style={styles.progressBar}>
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={[styles.progressPip, index <= step && styles.progressPipActive]}
          />
        ))}
      </View>

      <View style={styles.body}>
        {step === 0 ? <MobileOnboardingValueCard /> : null}
        {step === 1 ? <MobileOnboardingAgentsCard /> : null}
        {step === 2 ? <MobileOnboardingCreditsCard /> : null}
        {step === 3 ? <MobileOnboardingRepoStep onDone={onDone} /> : null}
      </View>

      {step < 3 ? (
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={onDone}
            style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={next}
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
          >
            <Text style={styles.primaryText}>Continue</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  progressBar: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
  },
  progressPip: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  progressPipActive: {
    backgroundColor: colors.fg,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing[5],
    justifyContent: "center",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
    paddingTop: spacing[3],
  },
  skip: {
    flex: 0,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
  },
  skipText: {
    color: colors.faint,
    fontSize: 14,
    fontWeight: "500",
  },
  primary: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.fg,
  },
  primaryPressed: {
    opacity: 0.85,
  },
  primaryText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.7,
  },
});
