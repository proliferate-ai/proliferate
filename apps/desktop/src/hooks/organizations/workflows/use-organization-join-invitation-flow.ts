import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthActions } from "@/hooks/auth/workflows/use-auth-actions";
import {
  useConnectServer,
  type UseConnectServerResult,
} from "@/hooks/auth/workflows/use-connect-server";
import {
  canFallbackToStandardInviteSignIn,
} from "@/lib/domain/organizations/join-auth";
import {
  clearPendingOrganizationJoinTarget,
  readPendingOrganizationJoinTarget,
  writePendingOrganizationJoinTarget,
} from "@/lib/access/browser/organization-join-target";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import { getDesktopAuthMethods } from "@/lib/integrations/auth/proliferate-auth-password";
import {
  getRuntimeDesktopAppConfig,
  isOfficialHostedApiBaseUrl,
} from "@/lib/infra/proliferate-api";
import { useAuthStore } from "@/stores/auth/auth-store";

/**
 * Normalize a URL to its origin (scheme + host + port, no path or trailing
 * slash) for comparison. Returns null when the input isn't a parseable URL.
 */
function toOrigin(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Does the invite link's (already-parser-validated) origin resolve to the
 * server the app is currently pointed at? An unset or official-hosted base
 * URL means the current server is Cloud, in which case an origin that is
 * itself an official hosted origin "matches" (Cloud invite on Cloud desktop —
 * no switch needed).
 */
function joinServerOriginMatchesCurrent(joinServerOrigin: string): boolean {
  const currentBaseUrl = getRuntimeDesktopAppConfig().apiBaseUrl;
  if (!currentBaseUrl || isOfficialHostedApiBaseUrl(currentBaseUrl)) {
    return isOfficialHostedApiBaseUrl(joinServerOrigin);
  }
  return toOrigin(currentBaseUrl) === toOrigin(joinServerOrigin);
}

export interface UseOrganizationJoinInvitationFlowResult {
  joinOrganizationId: string | null;
  clearJoinTarget: () => void;
  statusMessage: string | null;
  setStatusMessage: (value: string | null) => void;
  unauthenticatedJoin: boolean;
  /**
   * Connect-server controller driving the trust-confirm dialog when the invite
   * link is issued by a different server than the one the app is pointed at.
   * `connectServer.step === "closed"` when no switch is pending.
   */
  connectServer: UseConnectServerResult;
}

export function useOrganizationJoinInvitationFlow(): UseOrganizationJoinInvitationFlowResult {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authStatus = useAuthStore((state) => state.status);
  const { signInWithGitHub, signInWithSso } = useAuthActions();
  const connectServer = useConnectServer();
  const signInStartedRef = useRef(false);
  const serverSwitchStartedRef = useRef(false);
  const serverSwitchDialogOpenedRef = useRef(false);
  const joinOrganizationId = useMemo(
    () => searchParams.get("joinOrganizationId"),
    [searchParams],
  );
  const searchJoinServerOrigin = useMemo(
    () => searchParams.get("joinServerOrigin"),
    [searchParams],
  );
  const [transientJoinOrganizationId, setTransientJoinOrganizationId] = useState(
    () => joinOrganizationId ?? readPendingOrganizationJoinTarget(),
  );
  // The origin only ever arrives on the URL (never persisted): the relaunch
  // that a switch triggers restarts the app pointed AT that origin, so the
  // post-relaunch resume is a plain same-server join with no origin at all.
  // Hold it in transient state so the arrival navigate can safely drop the
  // param from the URL without stranding the switch.
  const [transientJoinServerOrigin, setTransientJoinServerOrigin] = useState(
    () => searchJoinServerOrigin,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const requiresServerSwitch = Boolean(
    transientJoinServerOrigin
    && connectServer.available
    && !joinServerOriginMatchesCurrent(transientJoinServerOrigin),
  );

  useEffect(() => {
    if (!joinOrganizationId) {
      return;
    }
    // Persist the target BEFORE any trust-confirm/relaunch: the relaunch drops
    // the URL params, so localStorage is what lets the flow resume against the
    // now-correct server.
    writePendingOrganizationJoinTarget(joinOrganizationId);
    signInStartedRef.current = false;
    setTransientJoinOrganizationId(joinOrganizationId);
    setTransientJoinServerOrigin(searchJoinServerOrigin);
    // Account is reachable by every signed-in user (Members is admin-only),
    // so this is where a non-admin invitee can actually see and accept.
    navigate(buildSettingsHref({ section: "account" }), { replace: true });
  }, [joinOrganizationId, searchJoinServerOrigin, navigate]);

  const clearJoinTarget = useCallback(() => {
    clearPendingOrganizationJoinTarget();
    setTransientJoinOrganizationId(null);
  }, []);

  useEffect(() => {
    if (
      !transientJoinOrganizationId
      || authStatus !== "authenticated"
    ) {
      return;
    }
    setStatusMessage("Review and accept the invitation below to join this organization.");
  }, [authStatus, transientJoinOrganizationId]);

  // SECURITY BOUNDARY: an invite link from a different server must never switch
  // the app silently or launch auth first. Surface the connect-server trust
  // dialog (which itself fetches `{origin}/meta` and requires an explicit
  // confirm) and start no authentication.
  useEffect(() => {
    if (
      !transientJoinOrganizationId
      || !requiresServerSwitch
      || !transientJoinServerOrigin
      || serverSwitchStartedRef.current
    ) {
      return;
    }
    serverSwitchStartedRef.current = true;
    setStatusMessage(
      "This invitation is hosted on a different Proliferate server. Confirm the connection to continue.",
    );
    void connectServer.openForUrl(transientJoinServerOrigin);
  }, [connectServer, requiresServerSwitch, transientJoinOrganizationId, transientJoinServerOrigin]);

  // Decline/cancel of the trust dialog: clear the pending join and stay put.
  // The dialog opens asynchronously, so we only treat a return to "closed" as a
  // decline once we've actually observed it open (never on the initial commit,
  // when step is still "closed").
  useEffect(() => {
    if (!serverSwitchStartedRef.current) {
      return;
    }
    if (connectServer.step !== "closed") {
      serverSwitchDialogOpenedRef.current = true;
      return;
    }
    // "connecting" leads into relaunch; only a return to "closed" is a decline.
    if (serverSwitchDialogOpenedRef.current) {
      serverSwitchDialogOpenedRef.current = false;
      serverSwitchStartedRef.current = false;
      clearJoinTarget();
      setStatusMessage(null);
    }
  }, [clearJoinTarget, connectServer.step]);

  useEffect(() => {
    if (
      !transientJoinOrganizationId
      || authStatus !== "anonymous"
      || requiresServerSwitch
      || signInStartedRef.current
    ) {
      return;
    }
    signInStartedRef.current = true;

    void (async () => {
      // Methods-aware sign-in: a password-only server (self-hosted with no
      // GitHub OAuth app) has no SSO/GitHub browser flow to launch, so leave
      // the user on the normal sign-in surface with guidance instead of firing
      // a dead redirect. Cloud advertises github, so it keeps today's behavior;
      // a fetch failure also falls through to the SSO/GitHub path.
      try {
        const methods = await getDesktopAuthMethods();
        if (methods.passwordLogin && !methods.github) {
          setStatusMessage(
            "Sign in to accept this invitation. Use the sign-in form below.",
          );
          return;
        }
      } catch {
        // Ignore — fall through to the SSO/GitHub launch (today's behavior).
      }

      setStatusMessage("Opening organization sign-in to accept this invitation.");
      try {
        await signInWithSso({
          organizationId: transientJoinOrganizationId,
          prompt: "select_account",
        });
      } catch (error: unknown) {
        if (!canFallbackToStandardInviteSignIn(error)) {
          setStatusMessage(
            "Sign in could not start. Use Account settings to sign in, then reopen the invite link.",
          );
          return;
        }

        setStatusMessage("Opening sign-in to accept this invitation.");
        try {
          await signInWithGitHub();
        } catch {
          setStatusMessage(
            "Sign in could not start. Use Account settings to sign in, then reopen the invite link.",
          );
        }
      }
    })();
  }, [
    authStatus,
    requiresServerSwitch,
    signInWithGitHub,
    signInWithSso,
    transientJoinOrganizationId,
  ]);

  return {
    joinOrganizationId: transientJoinOrganizationId,
    clearJoinTarget,
    statusMessage,
    setStatusMessage,
    unauthenticatedJoin: Boolean(transientJoinOrganizationId && authStatus !== "authenticated"),
    connectServer,
  };
}
