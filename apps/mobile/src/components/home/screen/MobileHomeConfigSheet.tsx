import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  cloudComposerControlTitle,
  formatCloudComposerControlValueLabel,
  type CloudChatComposerControlView,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import type { MobileRuntimeOption } from "../../../lib/domain/home/mobile-home-launch";
import { colors, spacing } from "../../../styles/tokens";
import { MobileHomeConfigControlDetail } from "./MobileHomeConfigControlDetail";
import {
  mobileHomeConfigControlIcon,
  MobileHomeConfigSheetRow,
  MobileHomeConfigSheetSection,
} from "./MobileHomeConfigSheetRows";

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
            <MobileHomeConfigControlDetail
              control={detailControl}
              onBack={() => setDetailControlId(null)}
              onSelect={(option) => {
                detailControl.onSelect?.(option.id);
                setDetailControlId(null);
              }}
            />
          ) : (
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <MobileHomeConfigSheetSection title="Configuration">
                {controls.map((control) => (
                  <MobileHomeConfigSheetRow
                    key={control.id}
                    icon={mobileHomeConfigControlIcon(control)}
                    title={cloudComposerControlTitle(control)}
                    value={formatCloudComposerControlValueLabel(control) ?? "Choose"}
                    disabled={control.disabled}
                    onPress={() => setDetailControlId(control.id)}
                  />
                ))}
              </MobileHomeConfigSheetSection>
              <MobileHomeConfigSheetSection title="Runtime">
                {runtimeOptions.map((runtime) => {
                  const offline = runtime.kind === "target" && !runtime.online;
                  return (
                    <MobileHomeConfigSheetRow
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
              </MobileHomeConfigSheetSection>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
});
