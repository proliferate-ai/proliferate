import type { StoredAuthSession } from "@/platform/tauri/auth";

export interface ActiveGitHubSignIn {
  state: string;
  abortController: AbortController;
  resolve: (session: StoredAuthSession) => void;
  reject: (error: Error) => void;
  promise: Promise<StoredAuthSession>;
  settled: boolean;
}

let activeGitHubSignIn: ActiveGitHubSignIn | null = null;

export function getActiveGitHubSignIn(): ActiveGitHubSignIn | null {
  return activeGitHubSignIn;
}

export function startGitHubSignIn(state: string): ActiveGitHubSignIn {
  if (activeGitHubSignIn && !activeGitHubSignIn.settled) {
    throw new Error("GitHub sign-in is already in progress");
  }

  const abortController = new AbortController();
  let resolve!: (session: StoredAuthSession) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<StoredAuthSession>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  activeGitHubSignIn = {
    state,
    abortController,
    resolve,
    reject,
    promise,
    settled: false,
  };

  return activeGitHubSignIn;
}

export function resolveGitHubSignIn(
  state: string,
  session: StoredAuthSession,
): void {
  if (!activeGitHubSignIn || activeGitHubSignIn.state !== state || activeGitHubSignIn.settled) {
    return;
  }

  activeGitHubSignIn.settled = true;
  activeGitHubSignIn.abortController.abort();
  activeGitHubSignIn.resolve(session);
  activeGitHubSignIn = null;
}

export function rejectGitHubSignIn(state: string, error: Error): void {
  if (!activeGitHubSignIn || activeGitHubSignIn.state !== state || activeGitHubSignIn.settled) {
    return;
  }

  activeGitHubSignIn.settled = true;
  activeGitHubSignIn.abortController.abort();
  activeGitHubSignIn.reject(error);
  activeGitHubSignIn = null;
}

export function cancelGitHubSignIn(state?: string, error?: Error): void {
  if (!activeGitHubSignIn) {
    return;
  }

  if (state && activeGitHubSignIn.state !== state) {
    return;
  }

  const current = activeGitHubSignIn;
  activeGitHubSignIn = null;
  current.abortController.abort();

  if (!current.settled) {
    current.settled = true;
    current.reject(error ?? new Error("GitHub sign-in cancelled."));
  }
}
