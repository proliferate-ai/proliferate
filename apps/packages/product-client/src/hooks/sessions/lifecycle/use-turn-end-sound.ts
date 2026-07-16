import { useEffect, useRef } from "react";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import {
  offUserFacingTurnEnd,
  onUserFacingTurnEnd,
} from "#product/lib/infra/events/turn-end-events";
import dingSrc from "../../../assets/sounds/ding.mp3";

export function useTurnEndSound(): void {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      const { turnEndSoundEnabled } = useUserPreferencesStore.getState();
      if (!turnEndSoundEnabled) return;

      // Construct (and thereby fetch) the clip lazily on the first turn-end that
      // actually needs it. This hook mounts in the shared lifecycle root above
      // the auth gate, so eager `new Audio(...)` with `preload="auto"` would
      // fetch the audio on the public login shell before the user signs in.
      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio(dingSrc);
        audio.preload = "auto";
        audioRef.current = audio;
      }
      audio.currentTime = 0;
      audio.play().catch(() => {});
    };

    onUserFacingTurnEnd(handler);
    return () => {
      offUserFacingTurnEnd(handler);
    };
  }, []);
}
