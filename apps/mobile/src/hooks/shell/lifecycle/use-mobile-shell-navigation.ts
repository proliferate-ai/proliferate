import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Linking } from "react-native";

import { useQueryClient } from "@tanstack/react-query";
import {
  githubAppRootKey,
  repositoriesKey,
  useCloudClient,
  useCloudWorkspace,
} from "@proliferate/cloud-sdk-react";

import { isMobileGitHubAppCallbackUrl } from "../../../lib/access/cloud/auth/mobile-github-app-callback";
import {
  clearMobileShellNavigation,
  persistMobileShellNavigation,
  restoreMobileShellNavigation,
} from "../../../lib/access/native/mobile-shell-navigation-storage";
import {
  mobileLinkedChatForWorkspace,
  mobileWorkspaceLinkFromUrl,
} from "../../../lib/domain/shell/mobile-shell-navigation";
import type { MobileCloudChat, RouteId } from "../../../navigation/navigation-model";
import type { MobileAuthState } from "../../../providers/MobileAuthProvider";

export interface MobileShellNavigation {
  route: RouteId;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  selectedChat: MobileCloudChat | null;
  /** Navigate to a top-level route, closing the drawer and any open chat. */
  navigate: (nextRoute: RouteId) => void;
  /** Open a chat, closing the drawer. */
  openChat: (chat: MobileCloudChat) => void;
  /** Return to the route view, discarding the open chat. */
  closeChat: () => void;
  markSelectedChatSession: (sessionId: string) => void;
  clearSelectedChatInitialPendingPrompt: () => void;
  /** Reset all navigation state to its signed-out defaults and clear storage. */
  resetForSignOut: (ownerUserId: string | null) => Promise<void>;
}

/**
 * Owns MobileShell's route/drawer/chat state plus its three side-effect
 * concerns: GitHub App callback / deep-link recovery, cross-launch
 * navigation persistence (restore on mount, persist on change), and the
 * Android hardware back button. Extracted so MobileShell itself stays a
 * thin render switch over auth/onboarding state.
 */
export function useMobileShellNavigation(
  authState: MobileAuthState,
  ownerUserId: string | null,
): MobileShellNavigation {
  const [route, setRoute] = useState<RouteId>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedChat, setSelectedChat] = useState<MobileCloudChat | null>(null);
  const [linkedWorkspaceId, setLinkedWorkspaceId] = useState<string | null>(null);
  const [linkedWorkspaceSessionId, setLinkedWorkspaceSessionId] = useState<string | null>(null);
  const [initialLinkChecked, setInitialLinkChecked] = useState(false);
  const [navigationRestored, setNavigationRestored] = useState(false);
  const initialLinkAppliedRef = useRef(false);
  const linkedWorkspace = useCloudWorkspace(
    linkedWorkspaceId,
    authState === "active" && linkedWorkspaceId !== null,
  );
  const queryClient = useQueryClient();
  const cloudClient = useCloudClient();

  const applyGitHubAppCallback = useCallback((url: string | null): boolean => {
    if (!isMobileGitHubAppCallbackUrl(url)) {
      return false;
    }
    // Callback return: invalidate authorization, installation, accessible
    // repos, per-repo authority, and repositories so the resolver re-runs. On a
    // warm return the in-memory modal intent survives and self-heals; on a cold
    // start we land in repository/access settings — no arbitrary command is
    // persisted (PR 7 acceptance: callback recovery is native-safe).
    void queryClient.invalidateQueries({ queryKey: githubAppRootKey(cloudClient.baseUrl) });
    void queryClient.invalidateQueries({ queryKey: repositoriesKey() });
    initialLinkAppliedRef.current = true;
    setRoute("settings");
    setSelectedChat(null);
    setDrawerOpen(false);
    return true;
  }, [cloudClient.baseUrl, queryClient]);

  const applyWorkspaceLink = useCallback((url: string | null): boolean => {
    if (applyGitHubAppCallback(url)) {
      return true;
    }
    const link = mobileWorkspaceLinkFromUrl(url);
    if (!link) {
      return false;
    }
    initialLinkAppliedRef.current = true;
    setLinkedWorkspaceId(link.workspaceId);
    setLinkedWorkspaceSessionId(link.sessionId);
    setRoute("work");
    setSelectedChat(null);
    setDrawerOpen(false);
    return true;
  }, [applyGitHubAppCallback]);

  useEffect(() => {
    let active = true;
    void Linking.getInitialURL()
      .then((url) => {
        if (active) {
          applyWorkspaceLink(url);
        }
      })
      .finally(() => {
        if (active) {
          setInitialLinkChecked(true);
        }
      });
    const subscription = Linking.addEventListener("url", ({ url }) => {
      applyWorkspaceLink(url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [applyWorkspaceLink]);

  useEffect(() => {
    if (authState !== "active") {
      setNavigationRestored(false);
      return;
    }
    if (!initialLinkChecked) {
      return;
    }
    if (initialLinkAppliedRef.current) {
      setNavigationRestored(true);
      return;
    }
    if (!ownerUserId) {
      return;
    }
    let cancelled = false;
    void restoreMobileShellNavigation(ownerUserId)
      .then((stored) => {
        if (cancelled) {
          return;
        }
        if (stored.route) {
          setRoute(stored.route);
        }
        if (stored.chat) {
          setSelectedChat(stored.chat);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setNavigationRestored(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authState, initialLinkChecked, ownerUserId]);

  useEffect(() => {
    if (authState !== "active" || !navigationRestored || !ownerUserId) {
      return;
    }
    void persistMobileShellNavigation(ownerUserId, route, selectedChat);
  }, [authState, navigationRestored, ownerUserId, route, selectedChat]);

  useEffect(() => {
    if (!linkedWorkspaceId || !linkedWorkspace.data) {
      return;
    }
    const chat = mobileLinkedChatForWorkspace(linkedWorkspace.data, [], linkedWorkspaceSessionId);
    if (chat) {
      setSelectedChat(chat);
    } else {
      setRoute("work");
    }
    setLinkedWorkspaceId(null);
    setLinkedWorkspaceSessionId(null);
  }, [linkedWorkspace.data, linkedWorkspaceId, linkedWorkspaceSessionId]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }
      if (selectedChat) {
        setSelectedChat(null);
        return true;
      }
      if (route !== "home") {
        setRoute("home");
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [drawerOpen, route, selectedChat]);

  const navigate = useCallback((nextRoute: RouteId) => {
    setRoute(nextRoute);
    setSelectedChat(null);
    setDrawerOpen(false);
  }, []);

  const openChat = useCallback((chat: MobileCloudChat) => {
    setSelectedChat(chat);
    setDrawerOpen(false);
  }, []);

  const closeChat = useCallback(() => {
    setSelectedChat(null);
  }, []);

  const markSelectedChatSession = useCallback((sessionId: string) => {
    setSelectedChat((current) => current ? { ...current, sessionId } : current);
  }, []);

  const clearSelectedChatInitialPendingPrompt = useCallback(() => {
    setSelectedChat((current) =>
      current?.initialPendingPrompt ? { ...current, initialPendingPrompt: null } : current
    );
  }, []);

  const resetForSignOut = useCallback(async (ownerUserIdAtSignOut: string | null) => {
    setRoute("home");
    setDrawerOpen(false);
    setSelectedChat(null);
    setLinkedWorkspaceId(null);
    setLinkedWorkspaceSessionId(null);
    setNavigationRestored(false);
    initialLinkAppliedRef.current = false;
    await clearMobileShellNavigation(ownerUserIdAtSignOut).catch(() => undefined);
  }, []);

  return useMemo(
    () => ({
      route,
      drawerOpen,
      setDrawerOpen,
      selectedChat,
      navigate,
      openChat,
      closeChat,
      markSelectedChatSession,
      clearSelectedChatInitialPendingPrompt,
      resetForSignOut,
    }),
    [
      clearSelectedChatInitialPendingPrompt,
      closeChat,
      drawerOpen,
      markSelectedChatSession,
      navigate,
      openChat,
      resetForSignOut,
      route,
      selectedChat,
    ],
  );
}
