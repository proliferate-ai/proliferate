import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CloudSessionProjection } from "@proliferate/cloud-sdk";
import {
  cloudComposerControlGroupLabel,
  cloudComposerControlTitle,
  formatCloudComposerControlValueLabel,
  normalizeCloudComposerModelLabel,
  type CloudChatComposerControlView,
  type CloudChatComposerControlOptionView,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileWorkspaceActionSheetProps {
  visible: boolean;
  initialExpandedId?: string | null;
  branchLabel: string;
  runtimeLabel: string;
  runtimeDetail: string;
  runtimeIcon: MobileIconName;
  unclaimed: boolean;
  claimPending: boolean;
  promptSubmitting: boolean;
  sessions: readonly CloudSessionProjection[];
  activeSessionId: string | null;
  newSessionMode: boolean;
  composerControls: readonly CloudChatComposerControlView[];
  onClaim: () => boolean | Promise<boolean>;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onCopyBranch: () => void;
  onClose: () => void;
}

export function MobileWorkspaceActionSheet({
  visible,
  initialExpandedId,
  branchLabel,
  runtimeLabel,
  runtimeDetail,
  runtimeIcon,
  unclaimed,
  claimPending,
  promptSubmitting,
  sessions,
  activeSessionId,
  newSessionMode,
  composerControls,
  onClaim,
  onNewSession,
  onSelectSession,
  onCopyBranch,
  onClose,
}: MobileWorkspaceActionSheetProps) {
  const [detailControlId, setDetailControlId] = useState<string | null>(null);
  const detailControl = useMemo(
    () => composerControls.find((control) => control.id === detailControlId) ?? null,
    [composerControls, detailControlId],
  );

  useEffect(() => {
    if (!visible) {
      setDetailControlId(null);
      return;
    }
    if (initialExpandedId?.startsWith("control:")) {
      setDetailControlId(initialExpandedId.slice("control:".length));
    }
  }, [initialExpandedId, visible]);

  async function runClaim() {
    const claimed = await onClaim();
    if (claimed) {
      onClose();
    }
  }

  function closeSheet() {
    setDetailControlId(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={closeSheet}>
      <View style={styles.layer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close workspace controls"
          style={styles.scrim}
          onPress={closeSheet}
        />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          {detailControl ? (
            <ControlDetailView
              control={detailControl}
              onBack={() => setDetailControlId(null)}
              onSelect={(option) => {
                detailControl.onSelect?.(option.id);
                setDetailControlId(null);
              }}
            />
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {unclaimed ? (
                <SheetSection>
                  <SheetRow
                    icon="hand"
                    title={claimPending ? "Claiming workspace" : "Claim workspace"}
                    subtitle="Unlock replies and sessions."
                    disabled={claimPending}
                    onPress={() => {
                      void runClaim();
                    }}
                  />
                </SheetSection>
              ) : null}

              <SheetSection title="Configuration">
                {composerControls.map((control) => (
                  <SheetRow
                    key={control.id}
                    icon={controlIcon(control)}
                    title={cloudComposerControlTitle(control)}
                    value={formatCloudComposerControlValueLabel(control) ?? "Choose"}
                    disabled={unclaimed || control.disabled}
                    onPress={() => setDetailControlId(control.id)}
                  />
                ))}
              </SheetSection>

              <SheetSection title="Sessions" count={sessions.length}>
                <SheetRow
                  icon="plus"
                  title="New session"
                  subtitle={
                    promptSubmitting
                      ? "Wait for the current prompt first."
                      : sessions.length
                        ? `Start separately from ${formatSessionCount(sessions.length)}.`
                        : "Start the first chat here."
                  }
                  selected={newSessionMode}
                  disabled={unclaimed || promptSubmitting}
                  onPress={() => {
                    onNewSession();
                    closeSheet();
                  }}
                />
                {sessions.map((session, index) => {
                  const selected = session.sessionId === activeSessionId && !newSessionMode;
                  return (
                    <SessionRow
                      key={session.sessionId}
                      session={session}
                      index={index}
                      selected={selected}
                      onPress={() => {
                        onSelectSession(session.sessionId);
                        closeSheet();
                      }}
                    />
                  );
                })}
              </SheetSection>

              <SheetSection title="Workspace">
                <SheetRow
                  icon="copy"
                  title="Copy branch"
                  value={branchLabel}
                  valueMono
                  onPress={() => {
                    onCopyBranch();
                    closeSheet();
                  }}
                />
                <SheetRow
                  icon={runtimeIcon}
                  title="Runtime"
                  subtitle={runtimeDetail}
                  value={runtimeLabel}
                  chevron={false}
                />
              </SheetSection>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ControlDetailView({
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
          accessibilityLabel="Back to controls"
          onPress={onBack}
          style={({ pressed }) => [styles.detailBack, pressed && styles.pressed]}
        >
          <MobileIcon name="chevron-left" size={18} color={colors.fg} />
        </Pressable>
        <Text style={styles.detailTitle}>{cloudComposerControlTitle(control)}</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.detailContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {control.groups.map((group) => {
          const groupLabel = cloudComposerControlGroupLabel(control, group);
          return (
            <View key={group.id} style={styles.optionGroup}>
              {groupLabel ? <Text style={styles.optionGroupTitle}>{groupLabel}</Text> : null}
              {group.options.map((option) => (
                <OptionRow
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

function SheetSection({
  title,
  count,
  children,
}: {
  title?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      {title ? (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {count !== undefined ? (
            <Text style={styles.sectionCount}>{count}</Text>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

function SheetRow({
  icon,
  title,
  subtitle,
  value,
  valueMono,
  selected,
  disabled,
  chevron = true,
  onPress,
}: {
  icon: MobileIconName;
  title: string;
  subtitle?: string | null;
  value?: string | null;
  valueMono?: boolean;
  selected?: boolean;
  disabled?: boolean;
  chevron?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ selected, disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        disabled && styles.rowDisabled,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.rowIcon}>
        <MobileIcon name={icon} size={16} color={disabled ? colors.faint : colors.fg} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, disabled && styles.rowTitleDisabled]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          style={[styles.rowValue, valueMono && styles.rowValueMono]}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {chevron ? <MobileIcon name="chevron-right" size={14} color={colors.faint} /> : null}
    </Pressable>
  );
}

function SessionRow({
  session,
  index,
  selected,
  onPress,
}: {
  session: CloudSessionProjection;
  index: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.sessionDot, { backgroundColor: sessionStatusColor(session.status) }]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {sessionDisplayTitle(session, index)}
        </Text>
        <Text
          style={[styles.rowSubtitle, isErrorStatus(session.status) && styles.rowSubtitleError]}
          numberOfLines={1}
        >
          {selected ? "Current · " : ""}
          {formatSessionStatus(session.status)} · {session.sessionId.slice(0, 8)}
        </Text>
      </View>
      {selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
    </Pressable>
  );
}

function OptionRow({
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
        option.selected && styles.rowSelected,
        option.disabled && styles.rowDisabled,
        pressed && !option.disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.optionCheck}>
        {option.selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
      </View>
      <View style={styles.rowText}>
        <Text
          style={[styles.optionTitle, option.disabled && styles.rowTitleDisabled]}
          numberOfLines={1}
        >
          {normalizeCloudComposerModelLabel(option.label)}
        </Text>
        {option.description ? (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {option.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function controlIcon(control: CloudChatComposerControlView): MobileIconName {
  switch (control.icon) {
    case "brain":
      return "brain";
    case "sparkles":
    case "zap":
      return "sparkles";
    case "shieldCheck":
      return "shield";
    case "claude":
      return "claude";
    case "openai":
      return "openai";
    case "gemini":
      return "gemini";
    case "opencodeBuild":
    case "bot":
      return "sparkles";
    case "settings":
    case "build":
    case "edit":
    case "opencodePlan":
    case "plan":
    case "read":
    default:
      return "settings";
  }
}

function sessionDisplayTitle(session: CloudSessionProjection, index: number): string {
  const title = session.title?.trim();
  return title || `Session ${index + 1}`;
}

function formatSessionCount(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}

function formatSessionStatus(status: string): string {
  const normalized = status.replace(/_/g, " ").trim();
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "Unknown";
}

function isErrorStatus(status: string): boolean {
  return status === "failed" || status === "error";
}

function sessionStatusColor(status: string): string {
  if (status === "running") {
    return colors.success;
  }
  if (isErrorStatus(status)) {
    return colors.destructive;
  }
  return colors.faint;
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
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
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderHeavy,
    marginBottom: spacing[2],
  },
  scroll: {
    minHeight: 0,
  },
  content: {
    paddingBottom: spacing[2],
  },
  section: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionHeader: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[2],
  },
  sectionTitle: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sectionCount: {
    minWidth: 22,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: colors.card,
    color: colors.mutedForeground,
    fontSize: 10.5,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
  row: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
  },
  rowSelected: {
    backgroundColor: colors.accent,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
  rowIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    color: colors.fg,
    fontSize: 13.5,
    fontWeight: "600",
  },
  rowTitleDisabled: {
    color: colors.faint,
  },
  rowSubtitle: {
    color: colors.faint,
    fontSize: 11.5,
    lineHeight: 15,
  },
  rowSubtitleError: {
    color: colors.destructive,
  },
  rowValue: {
    maxWidth: "42%",
    color: colors.mutedForeground,
    fontSize: 12.5,
    fontWeight: "500",
  },
  rowValueMono: {
    fontSize: 11.5,
  },
  sessionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginLeft: 6,
    marginRight: 7,
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
