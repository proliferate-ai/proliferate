import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type SettingsSection } from "@/config/settings";
import { type SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import {
  buildCloudRepoSettingsHref,
  buildSettingsHref,
  resolveSettingsSelection,
} from "@/lib/domain/settings/navigation";

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
  const rawCredential = searchParams.get("credential");
  const rawKind = searchParams.get("kind");
  const rawCheckout = searchParams.get("checkout");
  const rawInviteHandoff = searchParams.get("inviteHandoff");

  const selection = useMemo(() => resolveSettingsSelection({
    rawSection,
    rawRepo,
    rawCloudRepoOwner,
    rawCloudRepoName,
    rawFocus,
    rawTarget,
    rawCredential,
    rawKind,
    rawCheckout,
    rawInviteHandoff,
    repositories,
  }), [
    rawCloudRepoName,
    rawCloudRepoOwner,
    rawCredential,
    rawCheckout,
    rawFocus,
    rawInviteHandoff,
    rawKind,
    rawRepo,
    rawSection,
    rawTarget,
    repositories,
  ]);

  useEffect(() => {
    const expectedHref = buildSettingsHref({
      section: selection.activeSection,
      repo: selection.activeRepoSourceRoot,
      focus: selection.focus,
      inviteHandoff: selection.inviteHandoff,
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
    selection.inviteHandoff,
  ]);

  const navigateTo = useCallback((next: {
    section: SettingsSection;
    repo?: string | null;
  }) => {
    navigate(buildSettingsHref(next));
  }, [navigate]);

  const selectSection = useCallback((section: SettingsSection) => {
    navigateTo({ section });
  }, [navigateTo]);

  const selectRepo = useCallback((sourceRoot: string) => {
    navigateTo({
      section: "environments",
      repo: sourceRoot,
    });
  }, [navigateTo]);

  const selectCloudEnvironment = useCallback((gitOwner: string, gitRepoName: string) => {
    navigate(buildCloudRepoSettingsHref(gitOwner, gitRepoName));
  }, [navigate]);

  return {
    ...selection,
    selectSection,
    selectRepo,
    selectCloudEnvironment,
  };
}
