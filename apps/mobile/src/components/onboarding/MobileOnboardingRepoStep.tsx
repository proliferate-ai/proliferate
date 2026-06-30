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
import {
  useCloudGitRepositories,
  useRepoConfigs,
  useSaveCloudRepoConfig,
} from "@proliferate/cloud-sdk-react";

import { colors, spacing } from "../../styles/tokens";
import { MobileIcon } from "../primitives/MobileIcon";
import {
  mobileOnboardingCardTextStyles,
  MobileOnboardingIconHero,
} from "./MobileOnboardingCards";

export function MobileOnboardingRepoStep({ onDone }: { onDone: () => void }) {
  const repos = useCloudGitRepositories({}, true);
  const configured = useRepoConfigs();
  const save = useSaveCloudRepoConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const configuredKeys = useMemo(
    () => new Set(
      (configured.data?.repositories ?? [])
        .flatMap((config) => {
          const cloudEnvironment = config.environments.find((environment) =>
            environment.kind === "cloud"
          );
          return cloudEnvironment?.configured
            ? [`${config.gitOwner}/${config.gitRepoName}`]
            : [];
        }),
    ),
    [configured.data?.repositories],
  );

  const available = useMemo(() => {
    const all = (repos.data?.repositories ?? []).filter(
      (repo) => !configuredKeys.has(`${repo.gitOwner}/${repo.gitRepoName}`),
    );
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return all;
    return all.filter((repo) => repo.fullName.toLowerCase().includes(normalizedQuery));
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
        <MobileOnboardingIconHero icon="git-branch" />
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
          available.map((repo) => {
            const key = `${repo.gitOwner}/${repo.gitRepoName}`;
            const busy = busyKey === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                disabled={Boolean(busyKey)}
                onPress={() => void pick(repo.gitOwner, repo.gitRepoName, repo.defaultBranch ?? null)}
                style={({ pressed }) => [
                  styles.repoRow,
                  pressed && styles.repoRowPressed,
                  busy && styles.repoRowBusy,
                ]}
              >
                <MobileIcon name="git-branch" size={17} color={colors.fg} />
                <View style={styles.repoText}>
                  <Text style={styles.repoTitle} numberOfLines={1}>{repo.fullName}</Text>
                  {repo.defaultBranch ? (
                    <Text style={styles.repoSubtitle} numberOfLines={1}>{repo.defaultBranch}</Text>
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
  cardTitle: mobileOnboardingCardTextStyles.title,
  cardBody: mobileOnboardingCardTextStyles.body,
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
