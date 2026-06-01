import { BlurView } from "expo-blur";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, shadow } from "../../../styles/tokens";
import {
  MobilePopoverContext,
  type MobilePopoverContextValue,
  type MobilePopoverOverlay,
} from "../../../hooks/ui/popover/popover-context";

type Anchor =
  | "top-right"
  | "top-left"
  | "top-center"
  | "bottom-right"
  | "bottom-left"
  | "bottom-center"
  | "center";

interface MobilePopoverProps {
  visible: boolean;
  onClose: () => void;
  anchor?: Anchor;
  insetTop?: number;
  insetBottom?: number;
  insetSide?: number;
  width?: number;
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

const DEFAULT_WIDTH = 272;
const SUPPORTS_BLUR = Platform.OS === "ios" || Platform.OS === "android";

export function MobilePopover({
  visible,
  onClose,
  anchor = "top-right",
  insetTop = 58,
  insetBottom = 16,
  insetSide = 8,
  width = DEFAULT_WIDTH,
  children,
  contentStyle,
}: MobilePopoverProps) {
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;
  const cardRef = useRef<View>(null);
  const [cardHeight, setCardHeight] = useState(0);
  const [overlay, setOverlay] = useState<MobilePopoverOverlay | null>(null);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1,
          duration: 140,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 160,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fade.setValue(0);
      scale.setValue(0.96);
      setOverlay(null);
    }
  }, [visible, fade, scale]);

  const handleCardLayout = useCallback((event: LayoutChangeEvent) => {
    setCardHeight(event.nativeEvent.layout.height);
  }, []);

  const ctxValue = useMemo<MobilePopoverContextValue>(
    () => ({ cardRef, setOverlay, cardHeight }),
    [cardHeight],
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.scrim, { opacity: fade }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <View
        style={[styles.layer, anchorLayoutStyle(anchor, insetTop, insetBottom, insetSide)]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            styles.cardShadow,
            { width, opacity: fade, transform: [{ scale }] },
            contentStyle,
          ]}
        >
          <View ref={cardRef} style={styles.cardClip} onLayout={handleCardLayout}>
            {SUPPORTS_BLUR ? (
              <BlurView
                intensity={Platform.OS === "android" ? 32 : 60}
                tint={Platform.OS === "ios" ? "systemUltraThinMaterialDark" : "dark"}
                experimentalBlurMethod="dimezisBlurView"
                style={styles.cardSurface}
              >
                <View style={styles.cardOverlay} pointerEvents="box-none">
                  <MobilePopoverContext.Provider value={ctxValue}>
                    {children}
                  </MobilePopoverContext.Provider>
                </View>
              </BlurView>
            ) : (
              <View style={[styles.cardSurface, styles.cardSolid]}>
                <View style={styles.cardOverlay} pointerEvents="box-none">
                  <MobilePopoverContext.Provider value={ctxValue}>
                    {children}
                  </MobilePopoverContext.Provider>
                </View>
              </View>
            )}
          </View>
          {overlay ? (
            <View
              pointerEvents="box-none"
              style={[styles.overlayLayer, { top: overlay.top }]}
            >
              {overlay.content}
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

function anchorLayoutStyle(
  anchor: Anchor,
  insetTop: number,
  insetBottom: number,
  insetSide: number,
): ViewStyle {
  switch (anchor) {
    case "top-left":
      return { alignItems: "flex-start", paddingLeft: insetSide, paddingTop: insetTop };
    case "top-center":
      return { alignItems: "center", paddingTop: insetTop };
    case "bottom-left":
      return {
        alignItems: "flex-start",
        justifyContent: "flex-end",
        paddingLeft: insetSide,
        paddingBottom: insetBottom,
      };
    case "bottom-right":
      return {
        alignItems: "flex-end",
        justifyContent: "flex-end",
        paddingRight: insetSide,
        paddingBottom: insetBottom,
      };
    case "bottom-center":
      return { alignItems: "center", justifyContent: "flex-end", paddingBottom: insetBottom };
    case "center":
      return { alignItems: "center", justifyContent: "center" };
    case "top-right":
    default:
      return { alignItems: "flex-end", paddingRight: insetSide, paddingTop: insetTop };
  }
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  layer: {
    flex: 1,
  },
  cardShadow: {
    borderRadius: 18,
    ...shadow.floating,
  },
  cardClip: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.popoverRing,
    overflow: "hidden",
  },
  cardSurface: {
    backgroundColor: Platform.OS === "ios" ? "rgba(28,28,30,0.55)" : "rgba(36,36,36,0.85)",
  },
  cardSolid: {
    backgroundColor: colors.popover,
  },
  cardOverlay: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  overlayLayer: {
    position: "absolute",
    left: 0,
    right: 0,
  },
});
