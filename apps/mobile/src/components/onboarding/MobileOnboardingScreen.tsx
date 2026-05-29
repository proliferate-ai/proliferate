import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  useCloudGitRepositories,
  useCloudRepoConfigs,
  useSaveCloudRepoConfig,
} from "@proliferate/cloud-sdk-react";

import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import { colors, radius, spacing } from "../../styles/tokens";

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
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[styles.progressPip, i <= step && styles.progressPipActive]}
          />
        ))}
      </View>

      <View style={styles.body}>
        {step === 0 ? <ValueCard /> : null}
        {step === 1 ? <AgentsCard /> : null}
        {step === 2 ? <CreditsCard /> : null}
        {step === 3 ? <RepoStep onDone={onDone} /> : null}
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

function ValueCard() {
  return (
    <View style={styles.card}>
      <View style={styles.iconHero}>
        <MobileIcon name="cloud" size={36} color={colors.fg} />
      </View>
      <Text style={styles.cardTitle}>Use Proliferate from anywhere.</Text>
      <Text style={styles.cardBody}>
        Start a chat on mobile, continue it on web, finish on desktop. Sessions live on the cloud — pick up wherever you left off.
      </Text>
    </View>
  );
}

function AgentsCard() {
  const agents: { name: string; icon: MobileIconName }[] = [
    { name: "Claude Code", icon: "claude" },
    { name: "Codex", icon: "openai" },
    { name: "Gemini", icon: "gemini" },
    { name: "OpenCode", icon: "sparkles" },
    { name: "Cursor", icon: "sparkles" },
  ];
  return (
    <View style={styles.card}>
      <View style={styles.iconHero}>
        <MobileIcon name="sparkles" size={36} color={colors.fg} />
      </View>
      <Text style={styles.cardTitle}>Bring any agent.</Text>
      <Text style={styles.cardBody}>
        Use Claude Code, Codex, Gemini, OpenCode, or Cursor. Switch per chat. Same workspace, same files.
      </Text>
      <View style={styles.agentGrid}>
        {agents.map((agent) => (
          <View key={agent.name} style={styles.agentChip}>
            <MobileIcon name={agent.icon} size={16} color={colors.fg} />
            <Text style={styles.agentChipText}>{agent.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CreditsCard() {
  return (
    <View style={styles.card}>
      <View style={styles.iconHero}>
        <MobileIcon name="sparkles" size={36} color={colors.fg} />
      </View>
      <Text style={styles.cardTitle}>$5 in free credits.</Text>
      <Text style={styles.cardBody}>
        To get you started. After that you can bring your own API keys, configured from desktop or an org-wide env var.
      </Text>
    </View>
  );
}

function RepoStep({ onDone }: { onDone: () => void }) {
  const repos = useCloudGitRepositories({}, true);
  const configured = useCloudRepoConfigs();
  const save = useSaveCloudRepoConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const configuredKeys = useMemo(
    () => new Set(
      (configured.data?.configs ?? [])
        .filter((c) => c.configured)
        .map((c) => `${c.gitOwner}/${c.gitRepoName}`),
    ),
    [configured.data],
  );

  const available = useMemo(() => {
    const all = (repos.data?.repositories ?? []).filter(
      (r) => !configuredKeys.has(`${r.gitOwner}/${r.gitRepoName}`),
    );
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repos.data, configuredKeys, query]);

  async function pick(gitOwner: string, gitRepoName: string, defaultBranch: string | null) {
    const key = `${gitOwner}/${gitRepoName}`;
    setBusyKey(key);
    setError(null);
    try {
      await save.mutateAsync({
        gitOwner,
        gitRepoName,
        body: {
          configured: true,
          defaultBranch,
          envVars: {},
          setupScript: "",
          runCommand: "",
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save repository.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <View style={styles.repoStepRoot}>
      <View style={styles.repoStepHeader}>
        <View style={styles.iconHero}>
          <MobileIcon name="git-branch" size={32} color={colors.fg} />
        </View>
        <Text style={styles.cardTitle}>Pick a repository.</Text>
        <Text style={styles.cardBody}>
          Connect a GitHub repo so you can start a chat on it from anywhere.
        </Text>
      </View>
      <View style={styles.searchWrap}>
        <MobileIcon name="search" size={15} color={colors.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your repositories"
          placeholderTextColor={colors.faint}
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.searchInput}
        />
        {query ? (
          <Pressable accessibilityRole="button" onPress={() => setQuery("")}>
            <MobileIcon name="close" size={14} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        style={styles.repoList}
        contentContainerStyle={styles.repoListContent}
        keyboardShouldPersistTaps="handled"
      >
        {repos.isLoading ? (
          <View style={styles.repoEmpty}>
            <ActivityIndicator color={colors.faint} />
            <Text style={styles.repoEmptyText}>Loading your GitHub repos…</Text>
          </View>
        ) : repos.isError ? (
          <Text style={styles.repoEmptyText}>Could not load repositories.</Text>
        ) : available.length === 0 ? (
          <Text style={styles.repoEmptyText}>
            {query ? "No matches." : "All your repos are already configured."}
          </Text>
        ) : (
          available.map((r) => {
            const key = `${r.gitOwner}/${r.gitRepoName}`;
            const busy = busyKey === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                disabled={Boolean(busyKey)}
                onPress={() => void pick(r.gitOwner, r.gitRepoName, r.defaultBranch ?? null)}
                style={({ pressed }) => [
                  styles.repoRow,
                  pressed && styles.repoRowPressed,
                  busy && styles.repoRowBusy,
                ]}
              >
                <MobileIcon name="git-branch" size={17} color={colors.fg} />
                <View style={styles.repoText}>
                  <Text style={styles.repoTitle} numberOfLines={1}>{r.fullName}</Text>
                  {r.defaultBranch ? (
                    <Text style={styles.repoSubtitle} numberOfLines={1}>{r.defaultBranch}</Text>
                  ) : null}
                </View>
                {busy ? (
                  <ActivityIndicator color={colors.faint} />
                ) : (
                  <MobileIcon name="chevron-right" size={15} color={colors.faint} />
                )}
              </Pressable>
            );
          })
        )}
        {error ? <Text style={styles.repoError}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>I'll do this later</Text>
        </Pressable>
      </View>
    </View>
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
  card: {
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[2],
  },
  iconHero: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: spacing[2],
  },
  cardTitle: {
    color: colors.fg,
    fontSize: 24,
    fontWeight: "600",
    lineHeight: 30,
    textAlign: "center",
  },
  cardBody: {
    color: colors.mutedForeground,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    paddingHorizontal: spacing[2],
  },
  agentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing[2],
    marginTop: spacing[4],
  },
  agentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
  },
  agentChipText: {
    color: colors.fg,
    fontSize: 13,
    fontWeight: "500",
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
  repoStepRoot: {
    flex: 1,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
  },
  repoStepHeader: {
    alignItems: "center",
    gap: spacing[2],
    paddingBottom: spacing[4],
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
    marginBottom: spacing[2],
  },
  searchInput: {
    flex: 1,
    color: colors.fg,
    fontSize: 14,
  },
  repoList: {
    flex: 1,
  },
  repoListContent: {
    paddingBottom: spacing[3],
    gap: 2,
  },
  repoRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 12,
  },
  repoRowPressed: {
    backgroundColor: colors.accent,
  },
  repoRowBusy: {
    opacity: 0.7,
  },
  repoText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  repoTitle: {
    color: colors.fg,
    fontSize: 14.5,
    fontWeight: "500",
  },
  repoSubtitle: {
    color: colors.faint,
    fontSize: 12,
  },
  repoEmpty: {
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[5],
  },
  repoEmptyText: {
    color: colors.faint,
    fontSize: 13,
    textAlign: "center",
  },
  repoError: {
    color: colors.destructive,
    fontSize: 12.5,
    paddingHorizontal: spacing[2],
    paddingTop: spacing[2],
  },
});
