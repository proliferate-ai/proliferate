import { StyleSheet, Text, View } from "react-native";

import { MobileButton } from "../primitives/MobileButton";
import { MobileGlyph } from "../primitives/MobileGlyph";
import { colors, radius, text } from "../../styles/tokens";

interface MobileConnectGitHubScreenProps {
  onConnect: () => void;
  onSignOut: () => void;
}

export function MobileConnectGitHubScreen({
  onConnect,
  onSignOut,
}: MobileConnectGitHubScreenProps) {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <MobileGlyph tone="info">G</MobileGlyph>
        <Text style={styles.title}>Connect GitHub</Text>
        <Text style={text.body}>
          GitHub is the product identity for cloud sessions, workspaces, and
          automations.
        </Text>
        <View style={styles.actions}>
          <MobileButton label="Continue with GitHub" onPress={onConnect} />
          <MobileButton label="Sign out" variant="secondary" onPress={onSignOut} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    padding: 22,
    backgroundColor: colors.bg,
  },
  card: {
    gap: 14,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 18,
  },
  title: {
    color: colors.fg,
    fontSize: 22,
    fontWeight: "800",
  },
  actions: {
    gap: 10,
    marginTop: 6,
  },
});
