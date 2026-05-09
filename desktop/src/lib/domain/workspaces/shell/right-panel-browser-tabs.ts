import { normalizeBrowserUrl } from "@/lib/domain/workspaces/shell/browser-url";
import {
  browserIdsFromHeaderOrder,
  isValidRightPanelBrowserTabId,
  type RightPanelBrowserTab,
  type RightPanelBrowserTabsById,
  type RightPanelHeaderEntryKey,
} from "@/lib/domain/workspaces/shell/right-panel-model";

export function createRightPanelBrowserTabId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `browser-${Date.now().toString(36)}-${random}`;
}

export function browserTabTitle(tab: RightPanelBrowserTab, index: number): string {
  if (!tab.url) {
    return `Browser ${index + 1}`;
  }
  try {
    return new URL(tab.url).hostname || `Browser ${index + 1}`;
  } catch {
    return `Browser ${index + 1}`;
  }
}

export function sanitizeBrowserTabsById(
  value: unknown,
  headerOrder: readonly RightPanelHeaderEntryKey[] | undefined,
): RightPanelBrowserTabsById {
  if (!isRecord(value)) {
    return {};
  }

  const headerBrowserIds = new Set(browserIdsFromHeaderOrder(headerOrder));
  const next: RightPanelBrowserTabsById = {};
  for (const [browserId, rawTab] of Object.entries(value)) {
    if (!isValidRightPanelBrowserTabId(browserId) || !isRecord(rawTab)) {
      continue;
    }
    const tabId = rawTab.id;
    const rawUrl = rawTab.url;
    if (tabId !== browserId || !headerBrowserIds.has(browserId)) {
      continue;
    }
    if (rawUrl === null) {
      next[browserId] = { id: browserId, url: null };
      continue;
    }
    if (typeof rawUrl !== "string") {
      continue;
    }
    const normalizedUrl = normalizeBrowserUrl(rawUrl);
    if (!normalizedUrl) {
      continue;
    }
    next[browserId] = { id: browserId, url: normalizedUrl };
  }
  return next;
}

export function pickBrowserTabsInHeader(
  browserTabsById: RightPanelBrowserTabsById,
  headerOrder: readonly RightPanelHeaderEntryKey[],
): RightPanelBrowserTabsById {
  const next: RightPanelBrowserTabsById = {};
  for (const browserId of browserIdsFromHeaderOrder(headerOrder)) {
    const tab = browserTabsById[browserId];
    if (tab) {
      next[browserId] = tab;
    }
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
