import { StyleSheet, Text, View } from "react-native";

import { MobileButton } from "../primitives/MobileButton";
import { MobileGlyph } from "../primitives/MobileGlyph";
import { colors, radius, text } from "../../styles/tokens";

interface MobileAuthScreenProps {
  onGitHub: () => void;
}

export function MobileAuthScreen({ onGitHub }: MobileAuthScreenProps) {
  return (
    <View style={styles.root}>
      <View style={styles.mark}>
        <MobileGlyph>P</MobileGlyph>
      </View>
      <Text style={styles.title}>Proliferate</Text>
      <Text style={styles.subtitle}>Run and orchestrate coding agents from mobile.</Text>
      <View style={styles.actions}>
        <MobileButton label="Continue with GitHub" onPress={onGitHub} />
      </View>
      <Text style={text.caption}>
        GitHub is required before cloud workspaces and automations are available.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: colors.bg,
  },
  mark: {
    width: 66,
    height: 66,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  title: {
    color: colors.fg,
    fontSize: 28,
    fontWeight: "800",
    marginTop: 22,
  },
  subtitle: {
    maxWidth: 280,
    color: colors.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  actions: {
    alignSelf: "stretch",
    gap: 10,
    marginTop: 36,
    marginBottom: 16,
  },
});
