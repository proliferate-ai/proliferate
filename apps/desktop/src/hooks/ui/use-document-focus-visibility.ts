import { useEffect, useState } from "react";

export function isDocumentVisibleAndFocused(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

export function useDocumentFocusVisibilityNonce(): number {
  const [focusVisibilityNonce, setFocusVisibilityNonce] = useState(0);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const bumpFocusVisibilityNonce = () => {
      setFocusVisibilityNonce((value) => value + 1);
    };

    document.addEventListener("visibilitychange", bumpFocusVisibilityNonce);
    window.addEventListener("focus", bumpFocusVisibilityNonce);
    window.addEventListener("blur", bumpFocusVisibilityNonce);

    return () => {
      document.removeEventListener("visibilitychange", bumpFocusVisibilityNonce);
      window.removeEventListener("focus", bumpFocusVisibilityNonce);
      window.removeEventListener("blur", bumpFocusVisibilityNonce);
    };
  }, []);

  return focusVisibilityNonce;
}
