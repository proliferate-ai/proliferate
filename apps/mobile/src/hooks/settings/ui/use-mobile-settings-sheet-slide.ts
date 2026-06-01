import { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing } from "react-native";

export function useMobileSettingsSheetSlide(visible: boolean) {
  const screenHeight = Dimensions.get("window").height;
  const value = useRef(new Animated.Value(screenHeight)).current;
  useEffect(() => {
    Animated.timing(value, {
      toValue: visible ? 0 : screenHeight,
      duration: visible ? 280 : 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [visible, value, screenHeight]);
  return value;
}
