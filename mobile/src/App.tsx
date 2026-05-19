import { StatusBar } from "expo-status-bar";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

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

const markNodes = [
  { x: 35, y: 35, size: 24 },
  { x: 41, y: 2, size: 12 },
  { x: 61, y: 21, size: 12 },
  { x: 80, y: 41, size: 12 },
  { x: 61, y: 61, size: 12 },
  { x: 41, y: 80, size: 12 },
  { x: 21, y: 61, size: 12 },
  { x: 2, y: 41, size: 12 },
  { x: 21, y: 21, size: 12 },
];

function ProliferateMark({ size = 36 }: { size?: number }) {
  const frameSize = size + 24;
  const scale = size / 94;
  return (
    <View style={[styles.mark, { width: frameSize, height: frameSize }]}>
      <View style={[styles.markCanvas, { width: size, height: size }]}>
        {markNodes.map((node, index) => (
          <View
            key={`proliferate-mark-${index}`}
            style={[
              styles.markNode,
              {
                left: node.x * scale,
                top: node.y * scale,
                width: node.size * scale,
                height: node.size * scale,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={["top", "right", "bottom", "left"]}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <ProliferateMark />
            <Text style={styles.title}>Proliferate</Text>
            <Text style={styles.subtitle}>
              Mobile app scaffold is ready for native build validation.
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
    </SafeAreaProvider>
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
  markCanvas: {
    position: "relative",
  },
  markNode: {
    position: "absolute",
    backgroundColor: tokens.fg,
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
