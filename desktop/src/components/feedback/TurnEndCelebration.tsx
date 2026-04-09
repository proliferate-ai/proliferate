import { useCallback, useEffect, useState } from "react";
import { ProliferateIcon } from "@/components/ui/icons";
import { offTurnEnd, onTurnEnd } from "@/lib/integrations/anyharness/turn-end-events";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export function TurnEndCelebration() {
  const [runs, setRuns] = useState<number[]>([]);

  const handleTurnEnd = useCallback(() => {
    const { turnEndSoundEnabled, turnEndSoundId, themePreset } =
      useUserPreferencesStore.getState();
    if (!turnEndSoundEnabled) return;
    if (turnEndSoundId !== "gong" || themePreset !== "tbpn") return;
    setRuns((prev) => [...prev, Date.now()]);
  }, []);

  useEffect(() => {
    onTurnEnd(handleTurnEnd);
    return () => {
      offTurnEnd(handleTurnEnd);
    };
  }, [handleTurnEnd]);

  const handleAnimationEnd = useCallback((id: number) => {
    setRuns((prev) => prev.filter((r) => r !== id));
  }, []);

  if (runs.length === 0) return null;

  return (
    <>
      {runs.map((id) => (
        <div
          key={id}
          className="fixed bottom-4 left-0 z-50 pointer-events-none animate-turn-end-run"
          onAnimationEnd={() => handleAnimationEnd(id)}
        >
          <div className="relative flex flex-col items-center">
            <span className="animate-trophy-raise text-sm leading-none select-none">
              🏆
            </span>
            <div className="relative">
              <span className="absolute -left-2 top-1 block h-2.5 w-[3px] origin-bottom rounded-full bg-muted-foreground animate-arm-left" />
              <span className="absolute -right-2 top-1 block h-2.5 w-[3px] origin-bottom rounded-full bg-muted-foreground animate-arm-right" />
              <ProliferateIcon className="size-6 text-muted-foreground" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
