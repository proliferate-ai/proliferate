import type {
  TerminalRecord,
  TerminalStatus,
} from "@anyharness/sdk";
import { create } from "zustand";

export interface TerminalTab {
  id: string;
  workspaceId: string;
  title: string;
  cwd: string;
  status: TerminalStatus;
  exitCode?: number | null;
  unread: boolean;
}

interface TerminalState {
  tabsById: Record<string, TerminalTab>;
  workspaceTabs: Record<string, string[]>;
  activeTabByWorkspace: Record<string, string>;
  loadedWorkspaceTabs: Record<string, boolean>;
  connectionVersionByTerminal: Record<string, number>;

  setWorkspaceTabs: (workspaceId: string, records: TerminalRecord[]) => void;
  addTab: (workspaceId: string, record: TerminalRecord) => void;
  selectTab: (terminalId: string) => void;
  removeTab: (terminalId: string) => void;
  markUnread: (terminalId: string) => void;
  updateTabStatus: (terminalId: string, status: TerminalStatus, exitCode?: number | null) => void;
  bumpConnectionVersion: (terminalId: string) => void;
}

function recordToTab(r: TerminalRecord, workspaceIdOverride?: string): TerminalTab {
  return {
    id: r.id,
    workspaceId: workspaceIdOverride ?? r.workspaceId,
    title: r.title,
    cwd: r.cwd,
    status: r.status,
    exitCode: r.exitCode,
    unread: false,
  };
}

export const useTerminalStore = create<TerminalState>((set) => ({
  tabsById: {},
  workspaceTabs: {},
  activeTabByWorkspace: {},
  loadedWorkspaceTabs: {},
  connectionVersionByTerminal: {},

  setWorkspaceTabs: (workspaceId, records) => set(s => {
    const newTabsById = { ...s.tabsById };
    const tabIds: string[] = [];
    for (const record of records) {
      newTabsById[record.id] = recordToTab(record, workspaceId);
      tabIds.push(record.id);
    }
    const currentActive = s.activeTabByWorkspace[workspaceId];
    const nextActive = currentActive && tabIds.includes(currentActive)
      ? currentActive
      : (tabIds[0] ?? "");
    return {
      tabsById: newTabsById,
      workspaceTabs: { ...s.workspaceTabs, [workspaceId]: tabIds },
      activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceId]: nextActive },
      loadedWorkspaceTabs: { ...s.loadedWorkspaceTabs, [workspaceId]: true },
    };
  }),

  addTab: (workspaceId, record) => set(s => {
    const tab = recordToTab(record, workspaceId);
    const wsTabs = s.workspaceTabs[tab.workspaceId] ?? [];
    return {
      tabsById: { ...s.tabsById, [record.id]: tab },
      workspaceTabs: { ...s.workspaceTabs, [tab.workspaceId]: [...wsTabs, record.id] },
      activeTabByWorkspace: { ...s.activeTabByWorkspace, [tab.workspaceId]: record.id },
      loadedWorkspaceTabs: { ...s.loadedWorkspaceTabs, [tab.workspaceId]: true },
    };
  }),

  selectTab: (terminalId) => set(s => {
    const tab = s.tabsById[terminalId];
    if (!tab) return s;
    return {
      activeTabByWorkspace: { ...s.activeTabByWorkspace, [tab.workspaceId]: terminalId },
      tabsById: { ...s.tabsById, [terminalId]: { ...tab, unread: false } },
    };
  }),

  removeTab: (terminalId) => set(s => {
    const tab = s.tabsById[terminalId];
    if (!tab) return s;
    const newTabsById = { ...s.tabsById };
    delete newTabsById[terminalId];
    const wsTabs = (s.workspaceTabs[tab.workspaceId] ?? []).filter((id) => id !== terminalId);
    const activeTab = s.activeTabByWorkspace[tab.workspaceId];
    let newActiveTab = activeTab;
    if (activeTab === terminalId) {
      const oldTabs = s.workspaceTabs[tab.workspaceId] ?? [];
      const idx = oldTabs.indexOf(terminalId);
      newActiveTab = wsTabs.length > 0 ? wsTabs[Math.min(idx, wsTabs.length - 1)] : "";
    }
    return {
      tabsById: newTabsById,
      workspaceTabs: { ...s.workspaceTabs, [tab.workspaceId]: wsTabs },
      activeTabByWorkspace: { ...s.activeTabByWorkspace, [tab.workspaceId]: newActiveTab ?? "" },
    };
  }),

  markUnread: (terminalId) => set(s => {
    const tab = s.tabsById[terminalId];
    if (!tab || tab.unread) return s;
    return { tabsById: { ...s.tabsById, [terminalId]: { ...tab, unread: true } } };
  }),

  updateTabStatus: (terminalId, status, exitCode) => set(s => {
    const tab = s.tabsById[terminalId];
    if (!tab) return s;
    return {
      tabsById: {
        ...s.tabsById,
        [terminalId]: { ...tab, status, exitCode: exitCode ?? tab.exitCode },
      },
    };
  }),

  bumpConnectionVersion: (terminalId) => set(s => ({
    connectionVersionByTerminal: {
      ...s.connectionVersionByTerminal,
      [terminalId]: (s.connectionVersionByTerminal[terminalId] ?? 0) + 1,
    },
  })),
}));
