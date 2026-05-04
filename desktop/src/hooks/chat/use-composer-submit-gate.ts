import { useCallback, useRef, useState } from "react";

export function useComposerSubmitGate(): {
  isSubmitting: boolean;
  run: (action: () => Promise<void> | void) => Promise<boolean>;
} {
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const run = useCallback(async (action: () => Promise<void> | void): Promise<boolean> => {
    if (submittingRef.current) {
      return false;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await action();
      return true;
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, run };
}
