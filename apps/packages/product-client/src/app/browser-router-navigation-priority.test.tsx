// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";

interface UrgentStore {
  bump: () => void;
  getSnapshot: () => number;
  subscribe: (listener: () => void) => () => void;
}

function createUrgentStore(): UrgentStore {
  let snapshot = 0;
  const listeners = new Set<() => void>();

  return {
    bump: () => {
      snapshot += 1;
      listeners.forEach((listener) => listener());
    },
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function NavigationPriorityProbe({
  store,
  urgentSearches,
}: {
  store: UrgentStore;
  urgentSearches: string[];
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const previousSnapshot = useRef(snapshot);

  useLayoutEffect(() => {
    if (snapshot === previousSnapshot.current) {
      return;
    }
    previousSnapshot.current = snapshot;
    urgentSearches.push(location.search);
  }, [location.search, snapshot, urgentSearches]);

  const section = new URLSearchParams(location.search).get("section");
  return (
    <button
      type="button"
      aria-current={section === "appearance" ? "page" : undefined}
      onClick={() => {
        navigate("/settings?section=appearance");
        // Models a live transcript/store update arriving in the same frame as
        // the click. The route must participate in this urgent commit.
        flushSync(store.bump);
      }}
    >
      Appearance
    </button>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("browser-router navigation priority", () => {
  it("commits route-derived UI alongside competing urgent workspace work", () => {
    window.history.replaceState(null, "", "/settings?section=general");
    const store = createUrgentStore();
    const urgentSearches: string[] = [];

    render(
      <BrowserRouter useTransitions={false}>
        <NavigationPriorityProbe store={store} urgentSearches={urgentSearches} />
      </BrowserRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));

    expect(window.location.search).toBe("?section=appearance");
    expect(urgentSearches[0]).toBe("?section=appearance");
    expect(
      screen.getByRole("button", { name: "Appearance" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});
