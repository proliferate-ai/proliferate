import { create } from "zustand";
import { normalizeContentSearchQuery } from "#product/lib/domain/content-search/content-search";

export type ContentSearchSurface = "chat" | "file";

export interface ContentSearchUnitRegistration {
  unitId: string;
  surface?: ContentSearchSurface;
  query: string;
  matchIds: readonly string[];
  orderKey?: number;
}

interface ContentSearchUnit {
  unitId: string;
  surface: ContentSearchSurface;
  query: string;
  matchIds: string[];
  order: number;
  orderKey: number | null;
}

interface ContentSearchState {
  open: boolean;
  query: string;
  surface: ContentSearchSurface;
  activeMatchIndex: number;
  activeMatchId: string | null;
  unitsById: Record<string, ContentSearchUnit>;
  nextUnitOrder: number;
  openSearch: (surface?: ContentSearchSurface) => void;
  closeSearch: () => void;
  setQuery: (query: string) => void;
  goToNextMatch: () => void;
  goToPreviousMatch: () => void;
  registerUnit: (registration: ContentSearchUnitRegistration) => void;
  unregisterUnit: (unitId: string) => void;
}

export const useContentSearchStore = create<ContentSearchState>((set) => ({
  open: false,
  query: "",
  surface: "chat",
  activeMatchIndex: 0,
  activeMatchId: null,
  unitsById: {},
  nextUnitOrder: 0,

  openSearch: (surface = "chat") => {
    set((state) => resolveActiveMatch({
      ...state,
      open: true,
      surface,
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
      const surface = registration.surface ?? "chat";
      const orderKey = registration.orderKey ?? null;

      if (
        previous
        && previous.surface === surface
        && previous.query === query
        && previous.orderKey === orderKey
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
            surface,
            query,
            matchIds,
            order: previous?.order ?? state.nextUnitOrder,
            orderKey,
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
  "query" | "surface" | "unitsById"
>): string[] {
  const query = normalizeContentSearchQuery(state.query);
  if (!query) {
    return [];
  }

  return Object.values(state.unitsById)
    .filter((unit) => unit.surface === state.surface && unit.query === query)
    .sort(compareContentSearchUnits)
    .flatMap((unit) => unit.matchIds);
}

// Units with an explicit orderKey sort first, ascending. Units without one
// (e.g. inline diffs that can't cheaply learn their row index) fall after all
// keyed units, in registration order among themselves.
function compareContentSearchUnits(left: ContentSearchUnit, right: ContentSearchUnit): number {
  if (left.orderKey !== null && right.orderKey !== null) {
    return left.orderKey - right.orderKey || left.order - right.order;
  }
  if (left.orderKey !== null) {
    return -1;
  }
  if (right.orderKey !== null) {
    return 1;
  }
  return left.order - right.order;
}

function resolveActiveMatch<State extends Pick<
  ContentSearchState,
  "query" | "surface" | "unitsById"
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
