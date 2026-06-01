import { useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  cloudComposerControlGroupLabel,
  cloudComposerControlTitle,
  formatCloudComposerControlValueLabel,
  normalizeCloudComposerModelLabel,
  type CloudChatComposerControlOptionView,
  type CloudChatComposerControlView,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import type { MobileRuntimeOption } from "../../../lib/domain/home/mobile-home-launch";
import { colors, radius, spacing } from "../../../styles/tokens";
import { MobileIcon, type MobileIconName } from "../../primitives/MobileIcon";

interface MobileHomeConfigSheetProps {
  visible: boolean;
  controls: readonly CloudChatComposerControlView[];
  runtimeOptions: readonly MobileRuntimeOption[];
  selectedRuntimeId: string | null;
  onRuntimeSelect: (runtimeId: string) => void;
  onClose: () => void;
}

export function MobileHomeConfigSheet({
  visible,
  controls,
  runtimeOptions,
  selectedRuntimeId,
  onRuntimeSelect,
  onClose,
}: MobileHomeConfigSheetProps) {
  const [detailControlId, setDetailControlId] = useState<string | null>(null);
  const detailControl = controls.find((control) => control.id === detailControlId) ?? null;

  function close() {
    setDetailControlId(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.sheetLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close chat settings"
          style={styles.sheetScrim}
          onPress={close}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetGrabber} />
          {detailControl ? (
            <View style={styles.detail}>
              <View style={styles.detailHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to settings"
                  onPress={() => setDetailControlId(null)}
                  style={({ pressed }) => [styles.detailBack, pressed && styles.pressed]}
                >
                  <MobileIcon name="chevron-left" size={18} color={colors.fg} />
                </Pressable>
                <Text style={styles.detailTitle}>{cloudComposerControlTitle(detailControl)}</Text>
              </View>
              <ScrollView
                style={styles.sheetScroll}
                contentContainerStyle={styles.detailContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {detailControl.groups.map((group) => {
                  const label = cloudComposerControlGroupLabel(detailControl, group);
                  return (
                    <View key={group.id} style={styles.optionGroup}>
                      {label ? <Text style={styles.optionGroupTitle}>{label}</Text> : null}
                      {group.options.map((option) => (
                        <HomeOptionRow
                          key={option.id}
                          option={option}
                          onPress={() => {
                            detailControl.onSelect?.(option.id);
                            setDetailControlId(null);
                          }}
                        />
                      ))}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          ) : (
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <HomeSheetSection title="Configuration">
                {controls.map((control) => (
                  <HomeSheetRow
                    key={control.id}
                    icon={controlIcon(control)}
                    title={cloudComposerControlTitle(control)}
                    value={formatCloudComposerControlValueLabel(control) ?? "Choose"}
                    disabled={control.disabled}
                    onPress={() => setDetailControlId(control.id)}
                  />
                ))}
              </HomeSheetSection>
              <HomeSheetSection title="Runtime">
                {runtimeOptions.map((runtime) => {
                  const offline = runtime.kind === "target" && !runtime.online;
                  return (
                    <HomeSheetRow
                      key={runtime.id}
                      icon={runtime.icon}
                      title={runtime.label}
                      subtitle={offline ? `${runtime.description} · Offline` : runtime.description}
                      selected={runtime.id === selectedRuntimeId}
                      disabled={offline}
                      chevron={false}
                      onPress={() => {
                        onRuntimeSelect(runtime.id);
                      }}
                    />
                  );
                })}
              </HomeSheetSection>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function controlIcon(control: CloudChatComposerControlView | null): MobileIconName {
  switch (control?.icon) {
    case "brain":
      return "brain";
    case "sparkles":
      return "sparkles";
    case "openai":
      return "openai";
    case "claude":
      return "claude";
    case "gemini":
      return "gemini";
    case "opencodeBuild":
    case "bot":
      return "sparkles";
    case "settings":
      return "settings";
    default:
      return "cloud";
  }
}

function HomeSheetSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.sheetSection}>
      <Text style={styles.sheetSectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function HomeSheetRow({
  icon,
  title,
  subtitle,
  value,
  selected,
  disabled,
  chevron = true,
  onPress,
}: {
  icon: MobileIconName;
  title: string;
  subtitle?: string | null;
  value?: string | null;
  selected?: boolean;
  disabled?: boolean;
  chevron?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetRow,
        selected && styles.sheetRowSelected,
        disabled && styles.disabledPill,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.sheetRowIcon}>
        <MobileIcon name={icon} size={16} color={disabled ? colors.faint : colors.fg} />
      </View>
      <View style={styles.sheetRowText}>
        <Text style={[styles.sheetRowTitle, disabled && styles.sheetRowTitleDisabled]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.sheetRowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={styles.sheetRowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
      {chevron ? <MobileIcon name="chevron-right" size={14} color={colors.faint} /> : null}
    </Pressable>
  );
}

function HomeOptionRow({
  option,
  onPress,
}: {
  option: CloudChatComposerControlOptionView;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(option.selected), disabled: option.disabled }}
      disabled={option.disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        option.selected && styles.sheetRowSelected,
        option.disabled && styles.disabledPill,
        pressed && !option.disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.optionCheck}>
        {option.selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
      </View>
      <View style={styles.sheetRowText}>
        <Text style={[styles.optionTitle, option.disabled && styles.sheetRowTitleDisabled]} numberOfLines={1}>
          {normalizeCloudComposerModelLabel(option.label)}
        </Text>
        {option.description ? (
          <Text style={styles.sheetRowSubtitle} numberOfLines={2}>
            {option.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  sheetLayer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    maxHeight: "78%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderHeavy,
    backgroundColor: colors.popover,
    paddingTop: spacing[2],
    paddingBottom: spacing[4],
  },
  sheetGrabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderHeavy,
    marginBottom: spacing[2],
  },
  sheetScroll: {
    minHeight: 0,
  },
  sheetContent: {
    paddingBottom: spacing[2],
  },
  sheetSection: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetSectionTitle: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: spacing[2],
    paddingBottom: spacing[2],
  },
  sheetRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
  },
  sheetRowSelected: {
    backgroundColor: colors.accent,
  },
  sheetRowIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sheetRowTitle: {
    color: colors.fg,
    fontSize: 13.5,
    fontWeight: "600",
  },
  sheetRowTitleDisabled: {
    color: colors.faint,
  },
  sheetRowSubtitle: {
    color: colors.faint,
    fontSize: 11.5,
    lineHeight: 15,
  },
  sheetRowValue: {
    maxWidth: "42%",
    color: colors.mutedForeground,
    fontSize: 12.5,
    fontWeight: "500",
  },
  disabledPill: {
    opacity: 0.55,
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
  optionRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
  },
  optionCheck: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
  },
});
