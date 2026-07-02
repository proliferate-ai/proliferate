import { useEffect, useRef } from "react";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import {
  offUserFacingTurnEnd,
  onUserFacingTurnEnd,
} from "@/lib/infra/events/turn-end-events";
import dingSrc from "@/assets/sounds/ding.mp3";

export function useTurnEndSound(): void {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(dingSrc);
    audio.preload = "auto";
    audioRef.current = audio;
    return () => {
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      const { turnEndSoundEnabled } = useUserPreferencesStore.getState();
      if (!turnEndSoundEnabled) return;

      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
    };

    onUserFacingTurnEnd(handler);
    return () => {
      offUserFacingTurnEnd(handler);
    };
  }, []);
}
