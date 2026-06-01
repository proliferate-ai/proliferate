import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import type { CloudSessionProjection } from "@proliferate/cloud-sdk";
import type { CloudChatComposerControlView } from "@proliferate/product-domain/chats/cloud/composer-controls";

import { colors, spacing } from "../../styles/tokens";
import type { MobileIconName } from "../primitives/MobileIcon";
import { MobileWorkspaceActionControlDetail } from "./screen/MobileWorkspaceActionControlDetail";
import { MobileWorkspaceActionSheetSections } from "./screen/MobileWorkspaceActionSheetSections";

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
      closeSheet();
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
            <MobileWorkspaceActionControlDetail
              control={detailControl}
              onBack={() => setDetailControlId(null)}
              onSelect={(option) => {
                detailControl.onSelect?.(option.id);
                setDetailControlId(null);
              }}
            />
          ) : (
            <MobileWorkspaceActionSheetSections
              branchLabel={branchLabel}
              runtimeLabel={runtimeLabel}
              runtimeDetail={runtimeDetail}
              runtimeIcon={runtimeIcon}
              unclaimed={unclaimed}
              claimPending={claimPending}
              promptSubmitting={promptSubmitting}
              sessions={sessions}
              activeSessionId={activeSessionId}
              newSessionMode={newSessionMode}
              composerControls={composerControls}
              onClaim={() => {
                void runClaim();
              }}
              onNewSession={() => {
                onNewSession();
                closeSheet();
              }}
              onSelectSession={(sessionId) => {
                onSelectSession(sessionId);
                closeSheet();
              }}
              onCopyBranch={() => {
                onCopyBranch();
                closeSheet();
              }}
              onOpenControlDetail={setDetailControlId}
            />
          )}
        </View>
      </View>
    </Modal>
  );
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
});
