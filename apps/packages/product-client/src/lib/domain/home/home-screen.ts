import type { RepoConfigResponse } from "@proliferate/cloud-sdk";
import { HOME_SCREEN_LABELS } from "#product/copy/home/home-screen-copy";
import { getAgentDisplayLabel } from "#product/lib/domain/agents/provider-display";
import { cloudRepositoryKey } from "#product/lib/domain/settings/repositories";

export type HomeActionId =
  | "add-repository"
  | "agent-defaults"
  | "agent-settings"
  | "repository-settings";

export type HomeOnboardingActionId =
  | "add-repository"
  | "agent-defaults"
  | "repository-settings";

export type HomeOnboardingIcon = "github" | "settings" | "sliders";

export interface HomeOnboardingCardModel {
  id: HomeOnboardingActionId;
  title: string;
  description: string;
  icon: HomeOnboardingIcon;
}

/** The minimal agent identity the readiness card needs to name someone. */
export interface HomeReadinessAgent {
  kind: string;
  displayName: string;
}

/** The readiness card's bound content — never a "done" state (ruling 4). */
export interface HomeReadinessCardModel {
  /** Provider kind of the first ready agent, for the card's icon. */
  agentKind: string;
  title: string;
  description: string;
}

/**
 * One entry of the live reconcile job's per-component progress (D-R1/D-R2
 * fix). This — not the general agents list — is the card's input: the
 * agents list is a stale sample taken before the job starts and refetched
 * only after it ends, so it is blind for the entire install window, and its
 * own per-agent "installing" flag can only ever point at whichever single
 * agent the runtime is currently executing. The reconcile job's component
 * array carries one entry per component of every agent the job touches,
 * each with its own phase, and is the same live snapshot
 * HarnessUpdateToastPresenter already polls.
 */
export interface HomeInstallProgressComponent {
  agent: string;
  phase: string;
}

const READY_COMPONENT_PHASES = new Set(["completed", "skipped"]);

/**
 * Groups a job's components by agent to find who has fully settled (every
 * component completed or skipped) versus who still has a component in an
 * active phase. An agent with any `failed` component is excluded from both
 * sets — a failure is the terminal toast's decision to report, not this
 * card's; showing it as "still installing" would be false, and as "ready"
 * would be worse.
 */
function groupInstallProgressByAgent(
  components: readonly HomeInstallProgressComponent[],
): { readyAgents: HomeReadinessAgent[]; installingAgents: HomeReadinessAgent[] } {
  const phasesByAgent = new Map<string, string[]>();
  for (const component of components) {
    const phases = phasesByAgent.get(component.agent);
    if (phases) {
      phases.push(component.phase);
    } else {
      phasesByAgent.set(component.agent, [component.phase]);
    }
  }

  const readyAgents: HomeReadinessAgent[] = [];
  const installingAgents: HomeReadinessAgent[] = [];
  for (const [agentKind, phases] of phasesByAgent) {
    if (phases.some((phase) => phase === "failed")) {
      continue;
    }
    const agent = { kind: agentKind, displayName: getAgentDisplayLabel(agentKind) };
    if (phases.every((phase) => READY_COMPONENT_PHASES.has(phase))) {
      readyAgents.push(agent);
    } else {
      installingAgents.push(agent);
    }
  }
  return { readyAgents, installingAgents };
}

/**
 * Names the still-installing agents for the readiness card's secondary line.
 *
 * Names always; a count is only the OVERFLOW past the first name — so two
 * installing agents are both named ("Claude and Codex"), and three or more
 * name the first and count the rest ("Claude and 3 others"), which is the
 * exact shape the design artifact shows for a 4-agent install.
 */
function describeStillInstalling(installingNames: readonly string[]): string {
  if (installingNames.length === 0) {
    return "";
  }
  if (installingNames.length === 1) {
    return `${installingNames[0]} is still installing.`;
  }
  const [first, second, ...rest] = installingNames;
  if (rest.length === 0) {
    return `${first} and ${second} are still installing.`;
  }
  const overflow = rest.length + 1;
  return `${first} and ${overflow} others are still installing.`;
}

/**
 * The readiness card replacing the deleted model-probe card (UX spec §10
 * revision, ruling 4). Bound to per-agent readiness rather than a model
 * count: it exists only while the gate has resolved to something launchable
 * (or a selection away from it) AND the install job is still partially
 * running. There is no "done" state — the card unmounts entirely once every
 * agent has settled (readyAgents empty, or installingAgents empty because
 * the job resolved), which falls out of the grouping above rather than
 * needing its own check.
 */
export function resolveHomeReadinessCardModel(args: {
  gateKind: "launchable" | "selection_required" | "blocked";
  progressComponents: readonly HomeInstallProgressComponent[];
}): HomeReadinessCardModel | null {
  if (args.gateKind !== "selection_required" && args.gateKind !== "launchable") {
    return null;
  }
  const { readyAgents, installingAgents } = groupInstallProgressByAgent(args.progressComponents);
  const [firstReady] = readyAgents;
  if (!firstReady || installingAgents.length === 0) {
    return null;
  }
  // Spec correction (coordinator ruling): "You can start now." is true only
  // once the gate itself says launchable — selection_required means a model
  // still needs picking, so the claim is false exactly there. The gate's own
  // notice already owns the "pick a model" instruction; this card adds only
  // the still-installing sentence in that state.
  const startNowPrefix = args.gateKind === "launchable"
    ? "You can start now. "
    : "";
  return {
    agentKind: firstReady.kind,
    title: `${firstReady.displayName} is ready.`,
    description:
      `${startNowPrefix}${describeStillInstalling(installingAgents.map((agent) => agent.displayName))}`,
  };
}

export interface HomeRepositoryIdentity {
  sourceRoot?: string | null;
  gitProvider: string | null;
  gitOwner: string | null;
  gitRepoName: string | null;
}

function isGitHubRepository(repository: HomeRepositoryIdentity): boolean {
  return repository.gitProvider?.trim().toLowerCase() === "github"
    && Boolean(repository.gitOwner?.trim())
    && Boolean(repository.gitRepoName?.trim());
}

function configuredCloudRepositoryKeys(
  repoConfigs: readonly RepoConfigResponse[] | null | undefined,
): Set<string> {
  return new Set(
    (repoConfigs ?? [])
      .filter((repo) => repo.environments.some((environment) => environment.kind === "cloud"))
      .map((repo) => cloudRepositoryKey(repo.gitOwner, repo.gitRepoName)),
  );
}

function homeRepositoryKey(repository: HomeRepositoryIdentity): string | null {
  const gitOwner = repository.gitOwner?.trim();
  const gitRepoName = repository.gitRepoName?.trim();
  return gitOwner && gitRepoName
    ? cloudRepositoryKey(gitOwner, gitRepoName)
    : null;
}

export function findHomeUnconfiguredGitHubRepository(args: {
  repositories: readonly HomeRepositoryIdentity[];
  repoConfigs: readonly RepoConfigResponse[] | null | undefined;
}): HomeRepositoryIdentity | null {
  const configuredKeys = configuredCloudRepositoryKeys(args.repoConfigs);
  return args.repositories.find((repository) => {
    if (!isGitHubRepository(repository)) {
      return false;
    }
    const key = homeRepositoryKey(repository);
    return key ? !configuredKeys.has(key) : false;
  }) ?? null;
}

export function buildHomeOnboardingCards(args: {
  repositories: readonly HomeRepositoryIdentity[];
  repositoriesLoading: boolean;
  readyAgentCount: number;
  agentsLoading: boolean;
  defaultChatAgentKind: string;
  repoConfigs: readonly RepoConfigResponse[] | null | undefined;
  cloudRepoConfigsLoading: boolean;
}): HomeOnboardingCardModel[] {
  const cards: HomeOnboardingCardModel[] = [];
  const hasGitHubRepository =
    !args.repositoriesLoading && args.repositories.some(isGitHubRepository);
  const needsDefaultHarnesses =
    !args.agentsLoading
    && (args.readyAgentCount === 0 || args.defaultChatAgentKind.trim().length === 0);
  const needsRepositoryConfiguration =
    hasGitHubRepository
    && !args.cloudRepoConfigsLoading
    && findHomeUnconfiguredGitHubRepository({
      repositories: args.repositories,
      repoConfigs: args.repoConfigs,
    }) !== null;

  if (!args.repositoriesLoading && !hasGitHubRepository) {
    cards.push({
      id: "add-repository",
      title: HOME_SCREEN_LABELS.addGitHubRepositoryTitle,
      description: HOME_SCREEN_LABELS.addGitHubRepositoryDescription,
      icon: "github",
    });
  }

  if (needsDefaultHarnesses) {
    cards.push({
      id: "agent-defaults",
      title: HOME_SCREEN_LABELS.configureDefaultHarnessesTitle,
      description: HOME_SCREEN_LABELS.configureDefaultHarnessesDescription,
      icon: "sliders",
    });
  }

  if (needsRepositoryConfiguration) {
    cards.push({
      id: "repository-settings",
      title: HOME_SCREEN_LABELS.configureRepositoryTitle,
      description: HOME_SCREEN_LABELS.configureRepositoryDescription,
      icon: "settings",
    });
  }

  return cards;
}
