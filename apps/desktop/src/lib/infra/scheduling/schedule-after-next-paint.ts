export function scheduleAfterNextPaint(callback: () => void): () => void {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    const timeoutId = setTimeout(callback, 0);
    return () => clearTimeout(timeoutId);
  }

  let innerFrameId: number | null = null;
  const outerFrameId = window.requestAnimationFrame(() => {
    innerFrameId = window.requestAnimationFrame(callback);
  });

  return () => {
    window.cancelAnimationFrame(outerFrameId);
    if (innerFrameId !== null) {
      window.cancelAnimationFrame(innerFrameId);
    }
  };
}
