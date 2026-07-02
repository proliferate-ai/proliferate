import {
  SETTINGS_CONTENT_SECTIONS,
  SETTINGS_DEFAULT_SECTION,
  type SettingsSection,
} from "@/config/settings";
import {
  cloudRepositoryKey,
  isCloudRepository,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";

const FOCUS_PARAM_NAMES = [
  "focus",
  "target",
  "credential",
  "kind",
  "cloudRepoOwner",
  "cloudRepoName",
  "checkout",
  "joinOrganizationId",
] as const;

type SettingsFocusParam = (typeof FOCUS_PARAM_NAMES)[number];
export type SettingsFocus = Partial<Record<SettingsFocusParam, string>>;

export function isSettingsSection(value: string | null): value is SettingsSection {
  return SETTINGS_CONTENT_SECTIONS.some((item) => item === value);
}

export function normalizeSettingsSection(value: string | null): SettingsSection {
  if (value === "configuration") {
    return "general";
  }
  if (value === "defaults" || value === "advanced") {
    return "agent-defaults";
  }
  if (value === "repo" || value === "cloudRepo") {
    return "environments";
  }
  if (value === "slack-bot") {
    // SLACK BOT PARKED: old direct links fall back to the default settings page.
    return SETTINGS_DEFAULT_SECTION;
  }
  if (value === "shared-environments") {
    return SETTINGS_DEFAULT_SECTION;
  }
  if (value === "keyboard") {
    // KEYBOARD PANE REMOVED (owner rev 2026-07-01): the ⌘/ shortcuts modal is
    // the only surface, so old settings links fall back to the default page.
    return SETTINGS_DEFAULT_SECTION;
  }
  if (value === "cloud") {
    return "agent-authentication";
  }

  return isSettingsSection(value) ? value : SETTINGS_DEFAULT_SECTION;
}

interface SettingsNavigationTarget {
  section: SettingsSection | "repo";
  repo?: string | null;
  focus?: SettingsFocus | null;
  target?: string | null;
  credential?: string | null;
  kind?: string | null;
  joinOrganizationId?: string | null;
}

export function buildSettingsHref(target: SettingsNavigationTarget): string {
  const params = new URLSearchParams();
  const section = target.section === "repo" ? "environments" : target.section;
  params.set("section", section);
  if (section === "environments" && target.repo) {
    params.set("repo", target.repo);
  }
  const focus = target.focus ?? {};
  for (const name of FOCUS_PARAM_NAMES) {
    const value = focus[name];
    if (value) {
      params.set(name, value);
    }
  }
  if (section === "agent-authentication" && target.target) {
    params.set("target", target.target);
  }
  if (section === "agent-authentication" && target.credential) {
    params.set("credential", target.credential);
  }
  if (section === "agent-authentication" && target.kind) {
    params.set("kind", target.kind);
  }
  if (section === "organization-members" && target.joinOrganizationId) {
    params.set("joinOrganizationId", target.joinOrganizationId);
  }
  return `/settings?${params.toString()}`;
}

export function buildCloudSettingsHref(): string {
  return buildSettingsHref({ section: "agent-authentication" });
}

export function buildCloudRepoSettingsHref(
  gitOwner: string,
  gitRepoName: string,
): string {
  return buildSettingsHref({
    section: "environments",
    focus: {
      cloudRepoOwner: gitOwner,
      cloudRepoName: gitRepoName,
    },
  });
}

/**
 * Repository settings link for a workspace: cloud repos deep-link into the
 * cloud environment entry; local workspaces fall back to the repo root path
 * (or the workspace path) and resolve to null when neither is known.
 */
export function resolveWorkspaceRepoSettingsHref(input: {
  cloudRepoOwner?: string | null;
  cloudRepoName?: string | null;
  repoRootPath?: string | null;
  workspacePath?: string | null;
}): string | null {
  const cloudOwner = input.cloudRepoOwner?.trim() ?? "";
  const cloudName = input.cloudRepoName?.trim() ?? "";
  if (cloudOwner && cloudName) {
    return buildCloudRepoSettingsHref(cloudOwner, cloudName);
  }
  const localRepoPath = input.repoRootPath?.trim()
    || input.workspacePath?.trim()
    || "";
  if (!localRepoPath) {
    return null;
  }
  return buildSettingsHref({
    section: "repo",
    repo: localRepoPath,
  });
}

export interface SettingsSelectionInput {
  rawSection: string | null;
  rawRepo?: string | null;
  rawCloudRepoOwner?: string | null;
  rawCloudRepoName?: string | null;
  rawFocus?: string | null;
  rawTarget?: string | null;
  rawCredential?: string | null;
  rawKind?: string | null;
  rawCheckout?: string | null;
  rawJoinOrganizationId?: string | null;
  repositories: SettingsRepositoryEntry[];
}

export interface SettingsSelection {
  activeSection: SettingsSection;
  activeRepoSourceRoot: string | null;
  focus: SettingsFocus;
  joinOrganizationId: string | null;
}

export function resolveSettingsSelection({
  rawSection,
  rawRepo = null,
  rawCloudRepoOwner = null,
  rawCloudRepoName = null,
  rawFocus = null,
  rawTarget = null,
  rawCredential = null,
  rawKind = null,
  rawCheckout = null,
  rawJoinOrganizationId = null,
  repositories,
}: SettingsSelectionInput): SettingsSelection {
  const repositoryRoots = new Set(repositories.map((repository) => repository.sourceRoot));
  const cloudRepositoriesByKey = new Map<string, SettingsRepositoryEntry[]>();
  for (const repository of repositories) {
    if (!isCloudRepository(repository)) {
      continue;
    }
    const key = cloudRepositoryKey(repository.gitOwner, repository.gitRepoName);
    const entries = cloudRepositoriesByKey.get(key);
    if (entries) {
      entries.push(repository);
    } else {
      cloudRepositoriesByKey.set(key, [repository]);
    }
  }

  let section: SettingsSection = normalizeSettingsSection(rawSection);
  const focus: SettingsFocus = pickFocus({
    focus: rawFocus,
    target: rawTarget,
    credential: rawCredential,
    kind: rawKind,
    checkout: rawCheckout,
    joinOrganizationId: rawJoinOrganizationId,
    cloudRepoOwner: rawCloudRepoOwner,
    cloudRepoName: rawCloudRepoName,
  });
  let repoSourceRoot: string | null = section === "environments" ? rawRepo : null;

  if (rawSection === "cloud") {
    section = cloudRedirectSection(focus);
  }

  if (section === "environments" && rawRepo) {
    repoSourceRoot = rawRepo;
  }

  if (rawSection === "cloudRepo") {
    const cloudRepoKey = rawCloudRepoOwner && rawCloudRepoName
      ? cloudRepositoryKey(rawCloudRepoOwner, rawCloudRepoName)
      : null;
    const matches = cloudRepoKey ? (cloudRepositoriesByKey.get(cloudRepoKey) ?? []) : [];
    if (matches.length === 1) {
      section = "environments";
      repoSourceRoot = matches[0].sourceRoot;
    } else {
      section = "environments";
      repoSourceRoot = null;
    }
  }

  if (section === "environments") {
    if (!repoSourceRoot || !repositoryRoots.has(repoSourceRoot)) {
      repoSourceRoot = null;
    }
  }

  return {
    activeSection: section,
    activeRepoSourceRoot: repoSourceRoot,
    focus: sanitizeFocusForSection(section, focus),
    joinOrganizationId: section === "organization-members" ? rawJoinOrganizationId : null,
  };
}

function pickFocus(
  values: Partial<Record<SettingsFocusParam, string | null | undefined>>,
): SettingsFocus {
  const focus: SettingsFocus = {};
  for (const name of FOCUS_PARAM_NAMES) {
    const value = values[name];
    if (value) {
      focus[name] = value;
    }
  }
  return focus;
}

function cloudRedirectSection(focus: SettingsFocus): SettingsSection {
  if (focus.cloudRepoOwner || focus.cloudRepoName || focus.focus === "repo" || focus.focus === "environment") {
    return "environments";
  }
  if (focus.focus === "billing" || focus.focus === "credits") {
    return "billing";
  }
  return "agent-authentication";
}

function sanitizeFocusForSection(
  section: SettingsSection,
  focus: SettingsFocus,
): SettingsFocus {
  if (section === "agent-authentication") {
    return pickFocus({
      target: focus.target,
      credential: focus.credential,
      kind: focus.kind,
    });
  }
  if (section === "environments") {
    return pickFocus({
      focus: focus.focus,
      cloudRepoOwner: focus.cloudRepoOwner,
      cloudRepoName: focus.cloudRepoName,
    });
  }
  if (section === "billing") {
    return pickFocus({ checkout: focus.checkout });
  }
  if (section === "organization-members") {
    return pickFocus({ joinOrganizationId: focus.joinOrganizationId });
  }
  return {};
}
