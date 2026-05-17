import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type RouteId = "home" | "sessions" | "automations" | "settings";
type ChatMode = "Dispatch" | "Shared chat" | "Personal cloud";

const tokens = {
  bg: "#181818",
  sidebar: "#141414",
  card: "#212121",
  fg: "#ffffff",
  muted: "rgba(255,255,255,0.71)",
  faint: "rgba(255,255,255,0.50)",
  border: "rgba(255,255,255,0.084)",
  accent: "rgba(255,255,255,0.05)",
  blue: "#339cff",
  green: "#40c977",
};

const routes: { id: RouteId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "sessions", label: "Sessions" },
  { id: "automations", label: "Automations" },
  { id: "settings", label: "Settings" },
];

const modes: ChatMode[] = ["Dispatch", "Shared chat", "Personal cloud"];

const mockSessions = [
  {
    id: "1",
    title: "fix flaky CI on the worker",
    workspace: "Shared · proliferate",
    kind: "Slack",
    status: "Running",
    claim: "Unclaimed",
  },
  {
    id: "2",
    title: "Candidate Screening #12",
    workspace: "Shared · proliferate",
    kind: "Automation",
    status: "Running",
    claim: "Unclaimed",
  },
  {
    id: "3",
    title: "Git and File Modal Cleanup",
    workspace: "pablo / proliferate",
    kind: "Personal cloud",
    status: "Idle",
    claim: "Mine",
  },
];

const mockAutomations = [
  { name: "Candidate Screening", detail: "12 runs · enabled" },
  { name: "Dependency Bump", detail: "48 runs · enabled" },
  { name: "Triage Inbox", detail: "5 runs · paused" },
];

export default function App() {
  const [route, setRoute] = useState<RouteId>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<ChatMode>("Dispatch");

  const title = useMemo(() => routes.find((item) => item.id === route)?.label ?? "Home", [route]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open navigation"
          onPress={() => setDrawerOpen((value) => !value)}
          style={styles.iconButton}
        >
          <Text style={styles.iconText}>{drawerOpen ? "×" : "☰"}</Text>
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>{title}</Text>
          <Text style={styles.headerSubtitle}>Mobile preview</Text>
        </View>
      </View>

      {drawerOpen && (
        <View style={styles.drawer}>
          <Text style={styles.drawerBrand}>PROLIFERATE</Text>
          {routes.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => {
                setRoute(item.id);
                setDrawerOpen(false);
              }}
              style={[styles.drawerRow, route === item.id && styles.drawerRowActive]}
            >
              <Text style={styles.drawerRowText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {route === "home" && (
          <View style={styles.stack}>
            <Text style={styles.eyebrow}>New chat</Text>
            <Text style={styles.display}>Start work from anywhere.</Text>
            <View style={styles.segmented}>
              {modes.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  onPress={() => setMode(item)}
                  style={[styles.segment, mode === item && styles.segmentActive]}
                >
                  <Text style={[styles.segmentText, mode === item && styles.segmentTextActive]}>
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.composer}>
              <TextInput
                placeholder="Describe the task..."
                placeholderTextColor={tokens.faint}
                multiline
                style={styles.composerInput}
              />
              <Pressable accessibilityRole="button" style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Start {mode}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {route === "sessions" && (
          <View style={styles.stack}>
            <Text style={styles.eyebrow}>Sessions</Text>
            {mockSessions.map((session) => (
              <View key={session.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{session.title}</Text>
                  <Text style={styles.pill}>{session.status}</Text>
                </View>
                <Text style={styles.cardMeta}>
                  {session.workspace} · {session.kind}
                </Text>
                <Text style={styles.cardHint}>
                  {session.claim === "Unclaimed" ? "Claim to continue in desktop." : "Continue in desktop available."}
                </Text>
              </View>
            ))}
          </View>
        )}

        {route === "automations" && (
          <View style={styles.stack}>
            <Text style={styles.eyebrow}>Automations</Text>
            {mockAutomations.map((automation) => (
              <View key={automation.name} style={styles.card}>
                <Text style={styles.cardTitle}>{automation.name}</Text>
                <Text style={styles.cardMeta}>{automation.detail}</Text>
              </View>
            ))}
          </View>
        )}

        {route === "settings" && (
          <View style={styles.stack}>
            <Text style={styles.eyebrow}>Settings</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Mobile preview build</Text>
              <Text style={styles.cardMeta}>
                Configure plugins, MCPs, and cloud sandbox details from Web or Desktop.
              </Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>TestFlight readiness</Text>
              <Text style={styles.cardMeta}>
                Bundle id ai.proliferate.mobile · Sign in with Apple enabled · EAS profiles ready.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border,
  },
  iconButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: tokens.accent,
  },
  iconText: {
    color: tokens.fg,
    fontSize: 22,
    lineHeight: 24,
  },
  headerTitle: {
    color: tokens.fg,
    fontSize: 16,
    fontWeight: "600",
  },
  headerSubtitle: {
    color: tokens.faint,
    fontSize: 12,
    marginTop: 2,
  },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
    width: 292,
    paddingTop: 78,
    paddingHorizontal: 12,
    backgroundColor: tokens.sidebar,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: tokens.border,
  },
  drawerBrand: {
    color: tokens.fg,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 18,
    paddingHorizontal: 10,
  },
  drawerRow: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  drawerRowActive: {
    backgroundColor: tokens.accent,
  },
  drawerRowText: {
    color: tokens.fg,
    fontSize: 15,
    fontWeight: "500",
  },
  content: {
    padding: 18,
    paddingBottom: 36,
  },
  stack: {
    gap: 12,
  },
  eyebrow: {
    color: tokens.faint,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  display: {
    color: tokens.fg,
    fontSize: 30,
    fontWeight: "700",
    lineHeight: 35,
  },
  segmented: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 12,
    backgroundColor: tokens.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    paddingHorizontal: 8,
  },
  segmentActive: {
    backgroundColor: tokens.accent,
  },
  segmentText: {
    color: tokens.muted,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  segmentTextActive: {
    color: tokens.fg,
  },
  composer: {
    minHeight: 190,
    padding: 14,
    borderRadius: 16,
    backgroundColor: tokens.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border,
    gap: 12,
  },
  composerInput: {
    flex: 1,
    minHeight: 110,
    color: tokens.fg,
    fontSize: 16,
    textAlignVertical: "top",
  },
  primaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: tokens.fg,
  },
  primaryButtonText: {
    color: tokens.bg,
    fontSize: 14,
    fontWeight: "700",
  },
  card: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: tokens.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border,
    gap: 7,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cardTitle: {
    flex: 1,
    color: tokens.fg,
    fontSize: 15,
    fontWeight: "600",
  },
  cardMeta: {
    color: tokens.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  cardHint: {
    color: tokens.faint,
    fontSize: 12,
    lineHeight: 17,
  },
  pill: {
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: tokens.green,
    backgroundColor: "rgba(64,201,119,0.10)",
    fontSize: 11,
    fontWeight: "700",
  },
});
