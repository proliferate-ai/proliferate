import { useEffect, useRef } from "react";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import {
  offUserFacingTurnEnd,
  onUserFacingTurnEnd,
} from "@/lib/infra/events/turn-end-events";
import dingSrc from "@/assets/sounds/ding.mp3";
import gongSrc from "@/assets/sounds/gong.mp3";

export function useTurnEndSound(): void {
  const audioCache = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    const cache = audioCache.current;
    for (const [id, src] of Object.entries({ ding: dingSrc, gong: gongSrc })) {
      const audio = new Audio(src);
      audio.preload = "auto";
      cache.set(id, audio);
    }
    return () => {
      cache.clear();
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      const { turnEndSoundEnabled, turnEndSoundId, themePreset } =
        useUserPreferencesStore.getState();
      if (!turnEndSoundEnabled) return;

      const soundId =
        turnEndSoundId === "gong" && themePreset !== "tbpn"
          ? "ding"
          : turnEndSoundId;

      const audio = audioCache.current.get(soundId);
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
