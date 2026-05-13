export interface ProliferatePerfFlags {
  disableDebugMeasurement?: boolean;
  disablePromptFlushSync?: boolean;
  freezeHeaderTabsViewModel?: boolean;
  freezeComposerDock?: boolean;
  freezeMainScreenDataQueries?: boolean;
  freezeHeaderTabs?: boolean;
  freezeRightPanel?: boolean;
  freezeShellActivation?: boolean;
  freezeSidebar?: boolean;
  freezeTranscriptPane?: boolean;
  freezeWorkspaceContent?: boolean;
  pausePromptOutboxUi?: boolean;
  pauseSessionHistoryHydration?: boolean;
  pauseSessionStreamUi?: boolean;
  suppressAnyHarnessStreamMetrics?: boolean;
}

declare global {
  interface Window {
    proliferatePerfFlags?: ProliferatePerfFlags;
    proliferateSetPerfFlags?: (
      next:
        | ProliferatePerfFlags
        | ((current: ProliferatePerfFlags) => ProliferatePerfFlags),
    ) => ProliferatePerfFlags;
  }
}

export type ProliferatePerfFlagName = keyof ProliferatePerfFlags;

const listeners = new Set<() => void>();
const KNOWN_PERF_FLAGS = [
  "disableDebugMeasurement",
  "disablePromptFlushSync",
  "freezeComposerDock",
  "freezeHeaderTabs",
  "freezeHeaderTabsViewModel",
  "freezeMainScreenDataQueries",
  "freezeRightPanel",
  "freezeShellActivation",
  "freezeSidebar",
  "freezeTranscriptPane",
  "freezeWorkspaceContent",
  "pausePromptOutboxUi",
  "pauseSessionHistoryHydration",
  "pauseSessionStreamUi",
  "suppressAnyHarnessStreamMetrics",
] satisfies readonly ProliferatePerfFlagName[];
const KNOWN_PERF_FLAG_SET = new Set<string>(KNOWN_PERF_FLAGS);

export function getProliferatePerfFlags(): ProliferatePerfFlags {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return {};
  }
  installProliferatePerfFlagSetter();
  return window.proliferatePerfFlags ?? {};
}

export function isProliferatePerfFlagEnabled(
  flag: ProliferatePerfFlagName,
): boolean {
  return getProliferatePerfFlags()[flag] === true;
}

export function setProliferatePerfFlags(
  next:
    | ProliferatePerfFlags
    | ((current: ProliferatePerfFlags) => ProliferatePerfFlags),
): ProliferatePerfFlags {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return {};
  }
  const current = window.proliferatePerfFlags ?? {};
  const resolved = typeof next === "function" ? next(current) : next;
  window.proliferatePerfFlags = resolved;
  logPerfFlagUpdate(resolved);
  for (const listener of listeners) {
    listener();
  }
  return resolved;
}

export function subscribeProliferatePerfFlags(listener: () => void): () => void {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return () => undefined;
  }
  installProliferatePerfFlagSetter();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function installProliferatePerfFlagSetter(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return;
  }
  window.proliferateSetPerfFlags = setProliferatePerfFlags;
}

function logPerfFlagUpdate(flags: ProliferatePerfFlags): void {
  if (!import.meta.env.DEV || typeof console === "undefined") {
    return;
  }
  const keys = Object.keys(flags);
  const unknown = keys.filter((key) => !KNOWN_PERF_FLAG_SET.has(key));
  const active = KNOWN_PERF_FLAGS.filter((flag) => flags[flag] === true);
  if (unknown.length > 0) {
    console.warn("[proliferate-perf] Unknown perf flag(s):", unknown, {
      knownFlags: KNOWN_PERF_FLAGS,
    });
  }
  console.info("[proliferate-perf] Active perf flags:", active.length > 0 ? active : "(none)");
}
