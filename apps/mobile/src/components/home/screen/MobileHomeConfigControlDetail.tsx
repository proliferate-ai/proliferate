import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  cloudComposerControlGroupLabel,
  cloudComposerControlTitle,
  type CloudChatComposerControlOptionView,
  type CloudChatComposerControlView,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import { colors, radius, spacing } from "../../../styles/tokens";
import { MobileIcon } from "../../primitives/MobileIcon";
import { MobileHomeConfigOptionRow } from "./MobileHomeConfigSheetRows";

export function MobileHomeConfigControlDetail({
  control,
  onBack,
  onSelect,
}: {
  control: CloudChatComposerControlView;
  onBack: () => void;
  onSelect: (option: CloudChatComposerControlOptionView) => void;
}) {
  return (
    <View style={styles.detail}>
      <View style={styles.detailHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
          onPress={onBack}
          style={({ pressed }) => [styles.detailBack, pressed && styles.pressed]}
        >
          <MobileIcon name="chevron-left" size={18} color={colors.fg} />
        </Pressable>
        <Text style={styles.detailTitle}>{cloudComposerControlTitle(control)}</Text>
      </View>
      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={styles.detailContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {control.groups.map((group) => {
          const label = cloudComposerControlGroupLabel(control, group);
          return (
            <View key={group.id} style={styles.optionGroup}>
              {label ? <Text style={styles.optionGroupTitle}>{label}</Text> : null}
              {group.options.map((option) => (
                <MobileHomeConfigOptionRow
                  key={option.id}
                  option={option}
                  onPress={() => onSelect(option)}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  sheetScroll: {
    minHeight: 0,
  },
  detail: {
    minHeight: 260,
  },
  detailHeader: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  detailBack: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  detailTitle: {
    color: colors.fg,
    fontSize: 15.5,
    fontWeight: "700",
  },
  detailContent: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  optionGroup: {
    gap: spacing[1],
  },
  optionGroupTitle: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: spacing[2],
    paddingBottom: spacing[1],
  },
});
