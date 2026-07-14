import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host";

import { getStoredPendingAuthSession } from "@/lib/access/tauri/auth";
import {
  getActiveGitHubSignIn,
  rejectGitHubSignIn,
  resolveGitHubSignIn,
} from "@/lib/domain/auth/github-signin-state";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import {
  exchangeDesktopAuthCode,
  isDesktopAuthCallbackUrl,
  isPendingDesktopAuthExpired,
  parseDesktopAuthCallback,
} from "@/lib/integrations/auth/proliferate-auth";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import {
  applyAuthenticatedState,
  clearPendingGitHubAuth,
  markPendingCallbackUrl,
  markTelemetryHandled,
  toError,
  type AuthOrchestrationDeps,
} from "./orchestration-effects";
import {
  claimDesktopAuthPendingState,
  currentDesktopAuthTransaction,
  desktopAuthTransactionIsPendingRegistrationGap,
  desktopAuthTransactionOwnsState,
  isCurrentDesktopAuthTransaction,
  replaceDesktopAuthTransaction,
  resetDesktopAuthTransactionForRestore,
  type DesktopAuthTransaction,
} from "./desktop-auth-transaction";

interface CallbackFlight {
  key: string;
  state: string;
  transaction: DesktopAuthTransaction;
  promise: Promise<boolean>;
}

// One current host transaction only. This is not callback history or a queue:
// it lets duplicate native events join the current exchange and remembers only
// the most recently terminal callback until the next login starts.
let callbackFlight: CallbackFlight | null = null;
let lastConsumedCallbackKey: string | null = null;

/** Invalidates and detaches the old callback before its cancellation starts. */
export function beginDesktopAuthTransaction(): DesktopAuthTransaction {
  const transaction = replaceDesktopAuthTransaction();
  callbackFlight = null;
  lastConsumedCallbackKey = null;
  return transaction;
}

export function resetDesktopAuthCallbackConsumption(): void {
  resetDesktopAuthTransactionForRestore();
  callbackFlight = null;
  lastConsumedCallbackKey = null;
}

export async function handleDesktopCallbackUrl(
  url: string,
  deps: AuthOrchestrationDeps,
): Promise<boolean> {
  if (isDevAuthBypassed() || !isDesktopAuthCallbackUrl(url)) {
    return false;
  }

  const callback = parseDesktopAuthCallback(url);
  const state = callback?.state ?? callbackStateFromUrl(url) ?? "";
  const key = callbackKey(state, callback?.url ?? url);
  const transaction = currentDesktopAuthTransaction();
  if (
    callbackFlight
    && !isCurrentDesktopAuthTransaction(callbackFlight.transaction)
  ) {
    callbackFlight = null;
  }
  if (callbackFlight) {
    if (callbackFlight.key === key) {
      return callbackFlight.promise;
    }
    publishCallbackIssue(
      state === callbackFlight.state ? "already_consumed" : "state_mismatch",
      deps,
      transaction,
    );
    return true;
  }

  if (lastConsumedCallbackKey === key) {
    publishCallbackIssue("already_consumed", deps, transaction);
    return true;
  }

  const promise = callback
    ? processDesktopCallback(callback, key, deps, transaction)
    : handleMalformedCallback(url, deps, transaction).then(() => true);
  callbackFlight = { key, state, transaction, promise };
  try {
    return await promise;
  } finally {
    if (callbackFlight?.promise === promise) {
      callbackFlight = null;
    }
  }
}

async function handleMalformedCallback(
  url: string,
  deps: AuthOrchestrationDeps,
  transaction: DesktopAuthTransaction,
): Promise<void> {
  const pending = await getStoredPendingAuthSession();
  if (!isCurrentDesktopAuthTransaction(transaction)) {
    return;
  }
  if (desktopAuthTransactionIsPendingRegistrationGap(transaction)) {
    return;
  }
  const callbackState = callbackStateFromUrl(url);
  if (pending && isPendingDesktopAuthExpired(pending)) {
    if (!claimDesktopAuthPendingState(transaction, pending.state)) {
      return;
    }
    await clearPendingGitHubAuth(
      pending.state,
      new Error("Authentication expired. Start again from Proliferate."),
      transaction,
    );
    rememberConsumedCallback(callbackKey(pending.state, url), transaction);
    publishCallbackIssue("expired", deps, transaction);
    return;
  }
  if (pending && callbackState === pending.state) {
    if (!claimDesktopAuthPendingState(transaction, pending.state)) {
      return;
    }
    await clearPendingGitHubAuth(
      pending.state,
      new Error("Authentication failed: malformed callback."),
      transaction,
    );
  }
  rememberConsumedCallback(callbackKey(callbackState ?? "", url), transaction);
  publishCallbackIssue("malformed_callback", deps, transaction);
}

async function processDesktopCallback(
  callback: NonNullable<ReturnType<typeof parseDesktopAuthCallback>>,
  key: string,
  deps: AuthOrchestrationDeps,
  transaction: DesktopAuthTransaction,
): Promise<boolean> {
  const pending = await getStoredPendingAuthSession();
  if (!isCurrentDesktopAuthTransaction(transaction)) {
    return true;
  }
  if (!pending) {
    if (desktopAuthTransactionIsPendingRegistrationGap(transaction)) {
      return true;
    }
    rememberConsumedCallback(key, transaction);
    publishCallbackIssue("already_consumed", deps, transaction);
    return true;
  }

  if (!claimDesktopAuthPendingState(transaction, pending.state)) {
    // A replacement generation has not registered its new pending state yet.
    // The persisted record still belongs to the invalidated operation, so the
    // old callback is ignored rather than adopted or reported into N+1.
    return true;
  }

  if (isPendingDesktopAuthExpired(pending)) {
    await clearPendingGitHubAuth(
      pending.state,
      new Error("Authentication expired. Start again from Proliferate."),
      transaction,
    );
    rememberConsumedCallback(key, transaction);
    publishCallbackIssue("expired", deps, transaction);
    return true;
  }

  if (pending.state !== callback.state) {
    publishCallbackIssue("state_mismatch", deps, transaction);
    return true;
  }

  if (pending.last_handled_callback_url === callback.url) {
    await clearPendingGitHubAuth(pending.state, undefined, transaction);
    rememberConsumedCallback(key, transaction);
    publishCallbackIssue("already_consumed", deps, transaction);
    return true;
  }

  if (!await markPendingCallbackUrl(pending, callback.url, transaction)) {
    return true;
  }

  if (callback.error) {
    await clearPendingGitHubAuth(
      pending.state,
      new Error(`Authentication failed: ${callback.error}`),
      transaction,
    );
    rememberConsumedCallback(key, transaction);
    publishCallbackIssue("provider_error", deps, transaction, callback.error);
    return true;
  }

  // parseDesktopAuthCallback guarantees one of code/error is present.
  if (!callback.code) {
    await clearPendingGitHubAuth(pending.state, undefined, transaction);
    rememberConsumedCallback(key, transaction);
    publishCallbackIssue("malformed_callback", deps, transaction);
    return true;
  }

  try {
    const session = await exchangeDesktopAuthCode(
      callback.code,
      pending.code_verifier,
    );
    if (!desktopAuthTransactionOwnsState(transaction, pending.state)) {
      return true;
    }
    const activeSignIn = getActiveGitHubSignIn();
    const activeFlowOwnsCommit = activeSignIn?.state === pending.state;

    if (activeFlowOwnsCommit) {
      resolveGitHubSignIn(pending.state, session);
    }
    const cleared = await clearPendingGitHubAuth(
      pending.state,
      undefined,
      transaction,
    );
    if (
      cleared
      && !activeFlowOwnsCommit
      && isCurrentDesktopAuthTransaction(transaction)
    ) {
      await applyAuthenticatedState(deps, session, transaction);
    }
    rememberConsumedCallback(key, transaction);
    return true;
  } catch (error) {
    // Exchange failure is terminal for this callback. Cleanup and settle the
    // active flow before any telemetry/reporting that might itself throw.
    if (!desktopAuthTransactionOwnsState(transaction, pending.state)) {
      return true;
    }
    const normalizedError = markTelemetryHandled(
      toError(error, "Authentication failed"),
    );
    const cleared = await clearPendingGitHubAuth(
      pending.state,
      normalizedError,
      transaction,
    );
    if (!cleared || !isCurrentDesktopAuthTransaction(transaction)) {
      return true;
    }
    if (getActiveGitHubSignIn()?.state === pending.state) {
      rejectGitHubSignIn(pending.state, normalizedError);
    }
    rememberConsumedCallback(key, transaction);
    publishCallbackIssue("exchange_failed", deps, transaction);
    try {
      captureTelemetryException(error, {
        tags: {
          action: "callback_exchange",
          domain: "auth",
          provider: "github",
        },
      });
    } catch {
      // Terminal cleanup and the structured issue were already published.
    }
    return false;
  }
}

function publishCallbackIssue(
  reason: Extract<ProductAuthIssue, { kind: "callback_failed" }>["reason"],
  deps: AuthOrchestrationDeps,
  transaction: DesktopAuthTransaction,
  providerCode?: string,
): void {
  if (!isCurrentDesktopAuthTransaction(transaction)) {
    return;
  }
  const issue: ProductAuthIssue = {
    kind: "callback_failed",
    reason,
    ...(providerCode ? { providerCode } : {}),
  };
  deps.setAuthState({ issue });
  deps.showToast(callbackIssueMessage(reason));
}

function rememberConsumedCallback(
  key: string,
  transaction: DesktopAuthTransaction,
): void {
  if (isCurrentDesktopAuthTransaction(transaction)) {
    lastConsumedCallbackKey = key;
  }
}

function callbackIssueMessage(
  reason: Extract<ProductAuthIssue, { kind: "callback_failed" }>["reason"],
): string {
  switch (reason) {
    case "provider_error":
      return "Authentication was cancelled or rejected by the provider.";
    case "malformed_callback":
      return "Authentication returned an invalid callback. Start again.";
    case "state_mismatch":
      return "Authentication ignored a callback from a different sign-in attempt.";
    case "expired":
      return "Authentication expired. Start again from Proliferate.";
    case "exchange_failed":
      return "Authentication could not be completed. Start again.";
    case "already_consumed":
      return "This authentication callback was already handled.";
  }
}

function callbackStateFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("state");
  } catch {
    return null;
  }
}

function callbackKey(state: string, url: string): string {
  return `${state}\n${url}`;
}
