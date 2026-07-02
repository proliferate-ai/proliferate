import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type SettingsSection } from "@/config/settings";
import { type SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import {
  buildCloudRepoSettingsHref,
  buildSettingsHref,
  isRepoScopeSection,
  resolveSettingsSelection,
} from "@/lib/domain/settings/navigation";
import { type RepoSettingsContext } from "@/lib/domain/settings/repo-scope-selection";

interface UseSettingsNavigationArgs {
  repositories: SettingsRepositoryEntry[];
}

// Owns settings route normalization and navigation callbacks.
// Does not own section content state.
export function useSettingsNavigation({
  repositories,
}: UseSettingsNavigationArgs) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const rawSection = searchParams.get("section");
  const rawRepo = searchParams.get("repo");
  const rawCloudRepoOwner = searchParams.get("cloudRepoOwner");
  const rawCloudRepoName = searchParams.get("cloudRepoName");
  const rawFocus = searchParams.get("focus");
  const rawTarget = searchParams.get("target");
  const rawCheckout = searchParams.get("checkout");
  const rawJoinOrganizationId = searchParams.get("joinOrganizationId");
  const rawContext = searchParams.get("context");
  const rawFlowId = searchParams.get("flowId");
  const rawStatus = searchParams.get("status");
  const rawFailureCode = searchParams.get("failureCode");

  const selection = useMemo(() => resolveSettingsSelection({
    rawSection,
    rawRepo,
    rawCloudRepoOwner,
    rawCloudRepoName,
    rawFocus,
    rawTarget,
    rawCheckout,
    rawJoinOrganizationId,
    rawContext,
    rawFlowId,
    rawStatus,
    rawFailureCode,
    repositories,
  }), [
    rawCloudRepoName,
    rawCloudRepoOwner,
    rawContext,
    rawCheckout,
    rawFailureCode,
    rawFlowId,
    rawFocus,
    rawJoinOrganizationId,
    rawRepo,
    rawSection,
    rawStatus,
    rawTarget,
    repositories,
  ]);

  useEffect(() => {
    const expectedHref = buildSettingsHref({
      section: selection.activeSection,
      repo: selection.activeRepoSourceRoot,
      focus: selection.focus,
      joinOrganizationId: selection.joinOrganizationId,
    });
    const currentHref = `/settings?${searchParams.toString()}`;

    if (expectedHref !== currentHref) {
      navigate(expectedHref, { replace: true });
    }
  }, [
    navigate,
    searchParams,
    selection.activeRepoSourceRoot,
    selection.activeSection,
    selection.focus,
    selection.joinOrganizationId,
  ]);

  const activeSection = selection.activeSection;
  const activeRepoSourceRoot = selection.activeRepoSourceRoot;
  const activeContext = selection.focus.context;

  const selectSection = useCallback((section: SettingsSection) => {
    // Moving between repo-scope sections keeps the picked repo + Cloud|Local
    // context; every other move starts the target section clean.
    if (isRepoScopeSection(activeSection) && isRepoScopeSection(section)) {
      navigate(buildSettingsHref({
        section,
        repo: activeRepoSourceRoot,
        focus: { context: activeContext },
      }));
      return;
    }
    navigate(buildSettingsHref({ section }));
  }, [activeContext, activeRepoSourceRoot, activeSection, navigate]);

  const selectRepo = useCallback((sourceRoot: string) => {
    navigate(buildSettingsHref({
      section: isRepoScopeSection(activeSection) ? activeSection : "environments",
      repo: sourceRoot,
      focus: { context: activeContext },
    }));
  }, [activeContext, activeSection, navigate]);

  const selectRepoContext = useCallback((context: RepoSettingsContext) => {
    navigate(buildSettingsHref({
      section: isRepoScopeSection(activeSection) ? activeSection : "environments",
      repo: activeRepoSourceRoot,
      focus: { context },
    }));
  }, [activeRepoSourceRoot, activeSection, navigate]);

  const selectCloudEnvironment = useCallback((gitOwner: string, gitRepoName: string) => {
    navigate(buildCloudRepoSettingsHref(gitOwner, gitRepoName));
  }, [navigate]);

  return {
    ...selection,
    selectSection,
    selectRepo,
    selectRepoContext,
    selectCloudEnvironment,
  };
}
