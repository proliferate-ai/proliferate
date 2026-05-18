import { StyleSheet, Text, View } from "react-native";

import { MobileButton } from "../primitives/MobileButton";
import { MobileProliferateMark } from "../primitives/MobileProliferateMark";
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
      <View style={styles.content}>
        <View style={styles.mark}>
          <MobileProliferateMark size={28} />
        </View>
        <Text style={styles.title}>Connect GitHub</Text>
        <Text style={[text.body, styles.body]}>
          GitHub is the product identity for cloud sessions, workspaces, and
          automations.
        </Text>
        <View style={styles.actions}>
          <MobileButton label="Continue with GitHub" variant="secondary" onPress={onConnect} />
          <MobileButton label="Sign out" variant="secondary" onPress={onSignOut} />
        </View>
      </View>
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
  content: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
  },
  mark: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  title: {
    color: colors.fg,
    fontSize: 24,
    fontWeight: "700",
    marginTop: 22,
    textAlign: "center",
  },
  body: {
    marginTop: 10,
    textAlign: "center",
  },
  actions: {
    alignSelf: "stretch",
    gap: 10,
    marginTop: 32,
  },
});
