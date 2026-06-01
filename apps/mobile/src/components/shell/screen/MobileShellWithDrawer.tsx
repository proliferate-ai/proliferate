import type { ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useMobileShellDrawerMotion } from "../../../hooks/shell/ui/use-mobile-shell-drawer-motion";
import { colors } from "../../../styles/tokens";

interface MobileShellWithDrawerProps {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  drawer: ReactNode;
  children: ReactNode;
}

export function MobileShellWithDrawer({
  drawerOpen,
  setDrawerOpen,
  drawer,
  children,
}: MobileShellWithDrawerProps) {
  const drawerMotion = useMobileShellDrawerMotion({ drawerOpen, setDrawerOpen });

  return (
    <View style={styles.shellContainer} {...drawerMotion.panHandlers}>
      <View
        style={[
          styles.staticDrawer,
          { width: drawerMotion.drawerWidth },
        ]}
        pointerEvents={drawerOpen ? "auto" : "none"}
      >
        {drawer}
      </View>
      <Animated.View
        style={[
          styles.slidingContent,
          {
            borderTopLeftRadius: drawerMotion.contentRadius,
            borderBottomLeftRadius: drawerMotion.contentRadius,
            transform: [{ translateX: drawerMotion.translate }],
          },
        ]}
      >
        <SafeAreaView style={styles.slidingSafeArea} edges={["top", "right", "bottom", "left"]}>
          {children}
        </SafeAreaView>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.contentEdge,
            {
              borderTopLeftRadius: drawerMotion.contentRadius,
              borderBottomLeftRadius: drawerMotion.contentRadius,
              opacity: drawerMotion.edgeOpacity,
            },
          ]}
        />
        <Animated.View
          style={[styles.contentScrim, { opacity: drawerMotion.scrimOpacity }]}
          pointerEvents={drawerOpen && drawerMotion.scrimReady ? "auto" : "none"}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
            onPress={() => setDrawerOpen(false)}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  shellContainer: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: colors.sidebar,
  },
  staticDrawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 0,
  },
  slidingContent: {
    flex: 1,
    position: "relative",
    zIndex: 1,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  slidingSafeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentEdge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 32,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.borderHeavy,
    zIndex: 4,
  },
  contentScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
    zIndex: 5,
  },
});
