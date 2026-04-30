import { create } from "zustand";

interface TerminalState {
  activeTerminalByWorkspace: Record<string, string>;
  unreadByTerminal: Record<string, boolean>;
  connectionVersionByTerminal: Record<string, number>;

  setActiveTerminalForWorkspace: (workspaceId: string, terminalId: string | null) => void;
  markUnread: (terminalId: string) => void;
  clearUnread: (terminalId: string) => void;
  clearTerminalState: (terminalId: string) => void;
  bumpConnectionVersion: (terminalId: string) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  activeTerminalByWorkspace: {},
  unreadByTerminal: {},
  connectionVersionByTerminal: {},

  setActiveTerminalForWorkspace: (workspaceId, terminalId) => set((state) => {
    const activeTerminalByWorkspace = { ...state.activeTerminalByWorkspace };
    const unreadByTerminal = { ...state.unreadByTerminal };
    if (terminalId) {
      activeTerminalByWorkspace[workspaceId] = terminalId;
      delete unreadByTerminal[terminalId];
    } else {
      delete activeTerminalByWorkspace[workspaceId];
    }
    return {
      activeTerminalByWorkspace,
      unreadByTerminal,
    };
  }),

  markUnread: (terminalId) => set((state) => {
    if (state.unreadByTerminal[terminalId]) {
      return state;
    }
    return {
      unreadByTerminal: {
        ...state.unreadByTerminal,
        [terminalId]: true,
      },
    };
  }),

  clearUnread: (terminalId) => set((state) => {
    if (!state.unreadByTerminal[terminalId]) {
      return state;
    }
    const unreadByTerminal = { ...state.unreadByTerminal };
    delete unreadByTerminal[terminalId];
    return { unreadByTerminal };
  }),

  clearTerminalState: (terminalId) => set((state) => {
    const unreadByTerminal = { ...state.unreadByTerminal };
    const connectionVersionByTerminal = { ...state.connectionVersionByTerminal };
    const activeTerminalByWorkspace = { ...state.activeTerminalByWorkspace };

    delete unreadByTerminal[terminalId];
    delete connectionVersionByTerminal[terminalId];
    for (const [workspaceId, activeTerminalId] of Object.entries(activeTerminalByWorkspace)) {
      if (activeTerminalId === terminalId) {
        delete activeTerminalByWorkspace[workspaceId];
      }
    }

    return {
      activeTerminalByWorkspace,
      unreadByTerminal,
      connectionVersionByTerminal,
    };
  }),

  bumpConnectionVersion: (terminalId) => set((state) => ({
    connectionVersionByTerminal: {
      ...state.connectionVersionByTerminal,
      [terminalId]: (state.connectionVersionByTerminal[terminalId] ?? 0) + 1,
    },
  })),
}));
