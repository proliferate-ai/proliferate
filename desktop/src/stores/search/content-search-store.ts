import { create } from "zustand";
import { normalizeContentSearchQuery } from "@/lib/domain/content-search/content-search";

export type ContentSearchScope = "chat" | "diffs";

export interface ContentSearchUnitRegistration {
  unitId: string;
  scope: ContentSearchScope;
  query: string;
  matchIds: readonly string[];
}

interface ContentSearchUnit {
  unitId: string;
  scope: ContentSearchScope;
  query: string;
  matchIds: string[];
  order: number;
}

interface ContentSearchState {
  open: boolean;
  query: string;
  scope: ContentSearchScope;
  activeMatchIndex: number;
  activeMatchId: string | null;
  unitsById: Record<string, ContentSearchUnit>;
  nextUnitOrder: number;
  openSearch: (scope?: ContentSearchScope) => void;
  closeSearch: () => void;
  setQuery: (query: string) => void;
  setScope: (scope: ContentSearchScope) => void;
  goToNextMatch: () => void;
  goToPreviousMatch: () => void;
  registerUnit: (registration: ContentSearchUnitRegistration) => void;
  unregisterUnit: (unitId: string) => void;
}

export const useContentSearchStore = create<ContentSearchState>((set) => ({
  open: false,
  query: "",
  scope: "diffs",
  activeMatchIndex: 0,
  activeMatchId: null,
  unitsById: {},
  nextUnitOrder: 0,

  openSearch: (scope) => {
    set((state) => resolveActiveMatch({
      ...state,
      open: true,
      scope: scope ?? state.scope,
    }, 0));
  },

  closeSearch: () => {
    set({ open: false });
  },

  setQuery: (query) => {
    set((state) => resolveActiveMatch({
      ...state,
      query,
    }, 0));
  },

  setScope: (scope) => {
    set((state) => resolveActiveMatch({
      ...state,
      scope,
    }, 0));
  },

  goToNextMatch: () => {
    set((state) => resolveActiveMatch(state, state.activeMatchIndex + 1));
  },

  goToPreviousMatch: () => {
    set((state) => resolveActiveMatch(state, state.activeMatchIndex - 1));
  },

  registerUnit: (registration) => {
    set((state) => {
      const query = normalizeContentSearchQuery(registration.query);
      const matchIds = [...registration.matchIds];
      const previous = state.unitsById[registration.unitId];

      if (
        previous
        && previous.scope === registration.scope
        && previous.query === query
        && stringArraysEqual(previous.matchIds, matchIds)
      ) {
        return state;
      }

      const nextState = {
        ...state,
        nextUnitOrder: previous ? state.nextUnitOrder : state.nextUnitOrder + 1,
        unitsById: {
          ...state.unitsById,
          [registration.unitId]: {
            unitId: registration.unitId,
            scope: registration.scope,
            query,
            matchIds,
            order: previous?.order ?? state.nextUnitOrder,
          },
        },
      };
      return resolveActiveMatch(nextState, state.activeMatchIndex);
    });
  },

  unregisterUnit: (unitId) => {
    set((state) => {
      if (!state.unitsById[unitId]) {
        return state;
      }

      const unitsById = { ...state.unitsById };
      delete unitsById[unitId];
      return resolveActiveMatch({
        ...state,
        unitsById,
      }, state.activeMatchIndex);
    });
  },
}));

export function selectVisibleContentSearchMatchIds(state: Pick<
  ContentSearchState,
  "query" | "scope" | "unitsById"
>): string[] {
  const query = normalizeContentSearchQuery(state.query);
  if (!query) {
    return [];
  }

  return Object.values(state.unitsById)
    .filter((unit) => unit.scope === state.scope && unit.query === query)
    .sort((left, right) => left.order - right.order)
    .flatMap((unit) => unit.matchIds);
}

function resolveActiveMatch<State extends Pick<
  ContentSearchState,
  "query" | "scope" | "unitsById"
>>(
  state: State,
  requestedIndex: number,
): State & Pick<ContentSearchState, "activeMatchIndex" | "activeMatchId"> {
  const matchIds = selectVisibleContentSearchMatchIds(state);
  if (matchIds.length === 0) {
    return {
      ...state,
      activeMatchIndex: 0,
      activeMatchId: null,
    };
  }

  const activeMatchIndex = positiveModulo(requestedIndex, matchIds.length);
  return {
    ...state,
    activeMatchIndex,
    activeMatchId: matchIds[activeMatchIndex] ?? null,
  };
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}
