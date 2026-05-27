import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AutomationResponse } from "@proliferate/cloud-sdk";
import {
  useAutomations,
  usePauseAutomation,
  useResumeAutomation,
} from "@proliferate/cloud-sdk-react";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileListRow } from "../primitives/MobileListRow";
import { MobileEmptyState, MobileScreen } from "../primitives/MobileLayout";
import { MobileStatusDot } from "../primitives/MobileStatusDot";
import { colors, radius, spacing } from "../../styles/tokens";

export function MobileAutomationsScreen() {
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [togglingAutomationId, setTogglingAutomationId] = useState<string | null>(null);
  const automations = useAutomations({ ownerScope: "personal" });
  const pauseAutomation = usePauseAutomation({ ownerScope: "personal" });
  const resumeAutomation = useResumeAutomation({ ownerScope: "personal" });

  async function toggleAutomation(automation: AutomationResponse) {
    if (togglingAutomationId) {
      return;
    }
    setToggleError(null);
    setTogglingAutomationId(automation.id);
    try {
      if (automation.enabled) {
        await pauseAutomation.mutateAsync(automation.id);
      } else {
        await resumeAutomation.mutateAsync(automation.id);
      }
    } catch (error) {
      setToggleError(
        error instanceof Error
          ? error.message
          : "Automation status could not be changed.",
      );
    } finally {
      setTogglingAutomationId(null);
    }
  }

  return (
    <MobileScreen contentStyle={styles.screenContent}>
      <View style={styles.intro}>
        <Text style={styles.introText}>Cloud automations you set up on desktop or web.</Text>
      </View>

      {automations.isLoading ? (
        <MobileEmptyState title="Loading automations" body="Fetching scheduled cloud work." />
      ) : automations.error ? (
        <MobileEmptyState
          title="Could not load automations"
          body="Refresh later or sign in again."
        />
      ) : (automations.data?.automations ?? []).length === 0 ? (
        <MobileEmptyState
          title="No automations yet"
          body="Create cloud automations from desktop or web. They'll appear here so you can pause, resume, and check status."
        />
      ) : (
        <View style={styles.list}>
          {toggleError ? <Text style={styles.listErrorText}>{toggleError}</Text> : null}
          {(automations.data?.automations ?? []).map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              busy={togglingAutomationId === automation.id}
              onToggle={() => void toggleAutomation(automation)}
            />
          ))}
        </View>
      )}

      <Text style={styles.footnote}>
        Mobile is view-only. Create or edit automations on desktop or web.
      </Text>
    </MobileScreen>
  );
}

function AutomationRow({
  automation,
  busy,
  onToggle,
}: {
  automation: AutomationResponse;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <MobileListRow
      leading={<MobileStatusDot status={automation.enabled ? "running" : "paused"} size={8} />}
      title={automation.title}
      subtitle={`${automation.schedule.summary} - ${automation.gitOwner}/${automation.gitRepoName}`}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={automation.enabled ? "Pause automation" : "Resume automation"}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onToggle}
          style={({ pressed }) => [
            styles.statusPill,
            !automation.enabled && styles.statusPillPaused,
            busy && styles.statusPillDisabled,
            pressed && styles.pressed,
          ]}
        >
          <MobileIcon name="calendar-clock" size={12} color={automation.enabled ? colors.success : colors.faint} />
          <Text style={[styles.statusText, !automation.enabled && styles.statusTextPaused]}>
            {automation.enabled ? "On" : "Paused"}
          </Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  intro: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  introText: {
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 17,
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  listErrorText: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    color: colors.destructive,
    fontSize: 12.5,
    lineHeight: 17,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  statusPill: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: radius.full,
    backgroundColor: colors.successSubtle,
  },
  statusPillPaused: {
    backgroundColor: colors.accent,
  },
  statusPillDisabled: {
    opacity: 0.55,
  },
  statusText: {
    color: colors.success,
    fontSize: 11.5,
    fontWeight: "600",
  },
  statusTextPaused: {
    color: colors.faint,
  },
  footnote: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    color: colors.faint,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.7,
  },
});
