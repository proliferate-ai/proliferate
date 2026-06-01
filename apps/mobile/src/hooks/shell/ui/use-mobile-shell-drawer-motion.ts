import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  PanResponder,
} from "react-native";

export const MOBILE_SHELL_DRAWER_WIDTH = Math.min(
  300,
  Math.round(Dimensions.get("window").width * 0.76),
);

export function useMobileShellDrawerMotion({
  drawerOpen,
  setDrawerOpen,
}: {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}) {
  const translate = useRef(new Animated.Value(0)).current;
  const [scrimReady, setScrimReady] = useState(false);
  const draggingRef = useRef(false);
  const scrimOpacity = useMemo(
    () => translate.interpolate({
      inputRange: [0, MOBILE_SHELL_DRAWER_WIDTH],
      outputRange: [0, 0.4],
      extrapolate: "clamp",
    }),
    [translate],
  );
  const contentRadius = useMemo(
    () => translate.interpolate({
      inputRange: [0, 36],
      outputRange: [0, 30],
      extrapolate: "clamp",
    }),
    [translate],
  );
  const edgeOpacity = useMemo(
    () => translate.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
      extrapolate: "clamp",
    }),
    [translate],
  );

  const animateTo = useCallback((open: boolean, velocity = 0) => {
    Animated.timing(translate, {
      toValue: open ? MOBILE_SHELL_DRAWER_WIDTH : 0,
      duration: Math.max(140, 260 - Math.abs(velocity) * 90),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      setDrawerOpen(open);
    });
  }, [setDrawerOpen, translate]);

  useEffect(() => {
    if (drawerOpen) {
      Keyboard.dismiss();
    }
    if (draggingRef.current) {
      return;
    }
    Animated.timing(translate, {
      toValue: drawerOpen ? MOBILE_SHELL_DRAWER_WIDTH : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    if (!drawerOpen) {
      setScrimReady(false);
      return;
    }
    const id = setTimeout(() => setScrimReady(true), 360);
    return () => clearTimeout(id);
  }, [drawerOpen, translate]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => {
          if (Math.abs(g.dy) > Math.abs(g.dx) * 1.2) {
            return false;
          }
          if (Math.abs(g.dx) < 8) {
            return false;
          }
          if (drawerOpen) {
            return true;
          }
          return g.x0 <= 28 && g.dx > 0;
        },
        onPanResponderGrant: () => {
          draggingRef.current = true;
          Keyboard.dismiss();
          translate.stopAnimation((value: number) => {
            translate.setValue(value);
          });
        },
        onPanResponderMove: (_e, g) => {
          const start = drawerOpen ? MOBILE_SHELL_DRAWER_WIDTH : 0;
          const next = Math.max(0, Math.min(MOBILE_SHELL_DRAWER_WIDTH, start + g.dx));
          translate.setValue(next);
        },
        onPanResponderRelease: (_e, g) => {
          draggingRef.current = false;
          const start = drawerOpen ? MOBILE_SHELL_DRAWER_WIDTH : 0;
          const current = Math.max(0, Math.min(MOBILE_SHELL_DRAWER_WIDTH, start + g.dx));
          let shouldOpen: boolean;
          if (g.vx > 0.4) {
            shouldOpen = true;
          } else if (g.vx < -0.4) {
            shouldOpen = false;
          } else {
            shouldOpen = current > MOBILE_SHELL_DRAWER_WIDTH / 2;
          }
          animateTo(shouldOpen, g.vx);
        },
        onPanResponderTerminate: () => {
          draggingRef.current = false;
          animateTo(drawerOpen);
        },
      }),
    [animateTo, drawerOpen, translate],
  );

  return {
    contentRadius,
    drawerWidth: MOBILE_SHELL_DRAWER_WIDTH,
    edgeOpacity,
    panHandlers: panResponder.panHandlers,
    scrimOpacity,
    scrimReady,
    translate,
  };
}
