import { StyleSheet, Text, View } from "react-native";

import { colors, radius } from "../../styles/tokens";

interface MobileGlyphProps {
  children: string;
  tone?: "default" | "success" | "info" | "muted";
}

export function MobileGlyph({ children, tone = "default" }: MobileGlyphProps) {
  return (
    <View
      style={[
        styles.box,
        tone === "success" && styles.success,
        tone === "info" && styles.info,
        tone === "muted" && styles.muted,
      ]}
    >
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  success: {
    backgroundColor: "rgba(64,201,119,0.14)",
  },
  info: {
    backgroundColor: "rgba(51,156,255,0.14)",
  },
  muted: {
    backgroundColor: colors.card,
  },
  text: {
    color: colors.fg,
    fontSize: 12,
    fontWeight: "800",
  },
});
