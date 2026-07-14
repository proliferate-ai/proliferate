import {
  clearStoredPendingAuthSession,
  getStoredPendingAuthSession,
  setStoredPendingAuthSession,
  type StoredPendingAuthProvider,
  type StoredPendingAuthPurpose,
} from "@/lib/access/tauri/auth";
import {
  cancelGitHubSignIn,
  startGitHubSignIn,
} from "@/lib/domain/auth/github-signin-state";
import {
  abortError,
  createPendingDesktopAuth,
} from "@/lib/integrations/auth/proliferate-auth";
import {
  isCurrentDesktopAuthTransaction,
  registerDesktopAuthPendingState,
  staleDesktopAuthTransactionError,
  withDesktopAuthPendingMutation,
  type DesktopAuthTransaction,
} from "./desktop-auth-transaction";

export async function prepareProviderTransaction(
  provider: StoredPendingAuthProvider,
  purpose: StoredPendingAuthPurpose,
  transaction: DesktopAuthTransaction,
): Promise<{
  pending: ReturnType<typeof createPendingDesktopAuth>;
  controller: ReturnType<typeof startGitHubSignIn>;
}> {
  const prepared = await withDesktopAuthPendingMutation(
    transaction,
    async () => {
      // ProductHost has already accepted this as the replacement attempt.
      // Reconcile persisted/controller residue before publishing its owner.
      const existingPending = await getStoredPendingAuthSession();
      assertCurrentTransaction(transaction);
      if (existingPending) {
        await clearStoredPendingAuthSession();
      }
      cancelGitHubSignIn(
        undefined,
        abortError("A new sign-in attempt replaced the previous one."),
      );

      const pending = createPendingDesktopAuth(provider, purpose);
      if (!registerDesktopAuthPendingState(transaction, pending.state)) {
        throw staleDesktopAuthTransactionError();
      }
      await setStoredPendingAuthSession(pending);
      assertCurrentTransaction(transaction);
      const controller = startGitHubSignIn(pending.state);
      // Replacement can reject this before Promise.race attaches. Mark the
      // source handled without changing what later awaiters observe.
      void controller.promise.catch(() => {});
      return { pending, controller };
    },
  );

  if (!prepared) {
    throw staleDesktopAuthTransactionError();
  }
  return prepared;
}

export function assertCurrentTransaction(
  transaction: DesktopAuthTransaction,
): void {
  if (!isCurrentDesktopAuthTransaction(transaction)) {
    throw staleDesktopAuthTransactionError();
  }
}
