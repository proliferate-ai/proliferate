import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors } from "../../../styles/tokens";
import {
  useMobilePopover,
  useMobilePopoverGroup,
} from "../../../hooks/ui/popover/popover-context";
import { MobileIcon, type MobileIconName } from "../MobileIcon";

interface MobilePopoverDisclosureProps {
  id: string;
  icon?: MobileIconName;
  title: string;
  value?: string;
  disabled?: boolean;
  children: React.ReactNode;
}

export function MobilePopoverDisclosure({
  id,
  icon,
  title,
  value,
  disabled,
  children,
}: MobilePopoverDisclosureProps) {
  const group = useMobilePopoverGroup();
  const popover = useMobilePopover();
  const index = group?.registerIndex(id) ?? -1;
  const expanded = group?.expandedId === id;
  const dimmed = group?.isDimmed(index) ?? false;

  const containerRef = useRef<View>(null);
  const [rowHeight, setRowHeight] = useState(0);
  const [rowOffsetInCard, setRowOffsetInCard] = useState<number | null>(null);

  const onRowLayout = useCallback((event: LayoutChangeEvent) => {
    setRowHeight(event.nativeEvent.layout.height);
  }, []);

  // Measure where this disclosure sits inside the popover card so the overlay
  // can position its panel directly under the row.
  useEffect(() => {
    if (!expanded || !popover?.cardRef.current || !containerRef.current) {
      return;
    }
    containerRef.current.measureLayout(
      popover.cardRef.current as unknown as number,
      (_x, y) => setRowOffsetInCard(y),
      () => setRowOffsetInCard(null),
    );
  }, [expanded, popover, rowHeight, popover?.cardHeight]);

  // Publish the expanded panel into the popover's overlay layer.
  useEffect(() => {
    if (!popover) return;
    if (!expanded || rowOffsetInCard == null) {
      return;
    }
    const screenHeight = Dimensions.get("window").height;
    const maxPanelHeight = Math.max(160, Math.min(screenHeight * 0.55, 460));
    popover.setOverlay({
      top: rowOffsetInCard + rowHeight,
      content: (
        <View style={styles.panel}>
          <ScrollView
            style={{ maxHeight: maxPanelHeight }}
            contentContainerStyle={styles.panelContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      ),
    });
    return () => {
      popover.setOverlay(null);
    };
  }, [expanded, rowOffsetInCard, rowHeight, children, popover]);

  function toggle() {
    if (disabled) return;
    group?.setExpandedId(expanded ? null : id);
  }

  return (
    <View ref={containerRef} style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded }}
        disabled={disabled}
        onPress={toggle}
        onLayout={onRowLayout}
        style={({ pressed }) => [
          styles.row,
          dimmed && styles.rowDimmed,
          disabled && styles.rowDisabled,
          pressed && !disabled ? styles.rowPressed : null,
        ]}
      >
        {icon ? (
          <View style={styles.iconSlot}>
            <MobileIcon
              name={icon}
              size={17}
              color={disabled || dimmed ? colors.faint : colors.fg}
            />
          </View>
        ) : (
          <View style={styles.iconSlot} />
        )}
        <Text
          numberOfLines={1}
          style={[styles.title, dimmed && styles.titleDimmed, disabled && styles.titleDisabled]}
        >
          {title}
        </Text>
        {!expanded && value ? (
          <Text numberOfLines={1} style={styles.value}>
            {value}
          </Text>
        ) : null}
        <MobileIcon
          name={expanded ? "chevron-down" : "chevron-right"}
          size={14}
          color={colors.faint}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
  },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  rowDimmed: {
    opacity: 0.55,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  rowPressed: {
    backgroundColor: colors.popoverAccent,
  },
  iconSlot: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: colors.fg,
    fontSize: 15,
    fontWeight: "500",
  },
  titleDimmed: {
    color: colors.faint,
  },
  titleDisabled: {
    color: colors.faint,
  },
  value: {
    maxWidth: "46%",
    color: colors.faint,
    fontSize: 13,
    fontWeight: "500",
  },
  panel: {
    marginHorizontal: 4,
    marginTop: 4,
    backgroundColor: colors.muted,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderHeavy,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  panelContent: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
});
