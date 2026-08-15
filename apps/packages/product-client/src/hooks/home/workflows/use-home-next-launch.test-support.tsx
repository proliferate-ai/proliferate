import type { ReactNode } from "react";
import { renderHook, type RenderHookResult } from "@testing-library/react";

import { useHomeNextLaunch } from "#product/hooks/home/workflows/use-home-next-launch";
import { CoworkThreadLaunchProvider } from "#product/providers/CoworkThreadLaunchProvider";

// Shared harness for the `useHomeNextLaunch` suites (the routing half in
// `use-home-next-launch.test.tsx`, the concurrency half in
// `use-home-next-launch.concurrency.test.tsx`). Module mocks and the store
// reset stay in each test file — vitest registers mocks per file, and only a
// test file may write store state directly — but the render wrapper is the
// same for both, so it lives here once.

export function launchWrapper({ children }: { children: ReactNode }) {
  return <CoworkThreadLaunchProvider>{children}</CoworkThreadLaunchProvider>;
}

export function renderHomeNextLaunch(): RenderHookResult<
  ReturnType<typeof useHomeNextLaunch>,
  unknown
> {
  return renderHook(() => useHomeNextLaunch(), { wrapper: launchWrapper });
}

export function sessionIdForAttempt(attemptId: string) {
  return `client-session:codex:${attemptId}`;
}
