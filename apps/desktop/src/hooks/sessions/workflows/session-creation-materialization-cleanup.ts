import {
  shouldDiscardSupersededSessionCreation,
} from "@/hooks/sessions/workflows/session-creation-supersession";

export interface MaterializationLifecycle {
  discardCreatedSession: (() => Promise<boolean>) | null;
  retainCreatedSession: (() => void) | null;
}

export async function discardMaterializationIfSuperseded(
  sessionId: string,
  lifecycle: MaterializationLifecycle,
): Promise<boolean> {
  if (!await shouldDiscardSupersededSessionCreation(sessionId)) {
    return false;
  }
  const discardCreatedSession = lifecycle.discardCreatedSession;
  lifecycle.discardCreatedSession = null;
  if (!discardCreatedSession || await discardCreatedSession()) {
    lifecycle.retainCreatedSession = null;
    return true;
  }
  // The successor already committed, but this created runtime could not be
  // retired safely. Publish it honestly and stop this older materializer here.
  const retainCreatedSession = lifecycle.retainCreatedSession;
  lifecycle.retainCreatedSession = null;
  retainCreatedSession?.();
  return true;
}

export async function discardCreatedRuntimeSession(
  lifecycle: MaterializationLifecycle,
): Promise<boolean> {
  const discardCreatedSession = lifecycle.discardCreatedSession;
  lifecycle.discardCreatedSession = null;
  if (!discardCreatedSession || await discardCreatedSession()) {
    lifecycle.retainCreatedSession = null;
    return true;
  }
  const retainCreatedSession = lifecycle.retainCreatedSession;
  lifecycle.retainCreatedSession = null;
  retainCreatedSession?.();
  return false;
}
