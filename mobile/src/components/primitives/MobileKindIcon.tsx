import { StyleSheet, View } from "react-native";

import type { ChatKind } from "@proliferate/product-model/chats/model";

import { colors, radius } from "../../styles/tokens";
import { MobileIcon, type MobileIconName } from "./MobileIcon";

const ICON: Record<ChatKind, MobileIconName> = {
  slack: "slack",
  "shared-auto": "calendar-clock",
  "shared-chat": "users",
  cloud: "cloud",
  dispatch: "smartphone",
};

interface MobileKindIconProps {
  kind: ChatKind;
  size?: number;
}

export function MobileKindIcon({ kind, size = 36 }: MobileKindIconProps) {
  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: radius.md }]}>
      <MobileIcon name={ICON[kind]} size={Math.round(size * 0.42)} color={colors.mutedForeground} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
