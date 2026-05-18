import { StatusBar } from "expo-status-bar";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const tokens = {
  bg: "#181818",
  card: "#212121",
  fg: "#ffffff",
  muted: "rgba(255,255,255,0.71)",
  faint: "rgba(255,255,255,0.50)",
  border: "rgba(255,255,255,0.084)",
  accent: "rgba(255,255,255,0.05)",
  green: "#40c977",
};

function ProliferateMark({ size = 36 }: { size?: number }) {
  return (
    <View style={[styles.mark, { width: size + 24, height: size + 24 }]}>
      <Text style={[styles.markText, { fontSize: Math.round(size * 0.72) }]}>
        P
      </Text>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <ProliferateMark />
          <Text style={styles.title}>Proliferate</Text>
          <Text style={styles.subtitle}>
            Mobile release scaffold is ready for TestFlight.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>iOS build configuration</Text>
          <Text style={styles.cardText}>Bundle ID: ai.proliferate.mobile</Text>
          <Text style={styles.cardText}>Scheme: proliferate</Text>
          <Text style={styles.cardText}>Sign in with Apple: enabled</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next stack PRs</Text>
          <Text style={styles.cardText}>
            Shared design, auth, and product shell work lands in follow-up PRs.
          </Text>
        </View>

        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Expo app loaded</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
    gap: 14,
  },
  hero: {
    alignItems: "center",
    marginBottom: 22,
  },
  mark: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border,
    backgroundColor: tokens.card,
    marginBottom: 18,
  },
  markText: {
    color: tokens.fg,
    fontWeight: "700",
    lineHeight: 36,
  },
  title: {
    color: tokens.fg,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 0,
  },
  subtitle: {
    maxWidth: 280,
    marginTop: 8,
    color: tokens.muted,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
  card: {
    padding: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border,
    backgroundColor: tokens.card,
    gap: 6,
  },
  cardTitle: {
    color: tokens.fg,
    fontSize: 15,
    fontWeight: "700",
  },
  cardText: {
    color: tokens.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 999,
    backgroundColor: tokens.accent,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: tokens.green,
  },
  statusText: {
    color: tokens.faint,
    fontSize: 12,
    fontWeight: "600",
  },
});
