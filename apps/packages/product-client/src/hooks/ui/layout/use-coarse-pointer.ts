import { useEffect, useState } from "react";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

function readCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

/**
 * True on a touch-primary input (the media query, not a touch-event probe —
 * a laptop with a touchscreen alongside its trackpad still reports `fine`).
 * Anything gated on hover should read this first: a touch tap fires a
 * synthetic `mouseenter` with no guaranteed matching `mouseleave`, so a
 * hover-only affordance armed by real mouse movement gets stuck open on a
 * device that never had a mouse to move.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(readCoarsePointer);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(COARSE_POINTER_QUERY);
    const handleChange = () => { setCoarse(query.matches); };
    query.addEventListener("change", handleChange);
    return () => {
      query.removeEventListener("change", handleChange);
    };
  }, []);

  return coarse;
}
