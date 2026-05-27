import { StyleSheet, View } from "react-native";

import { colors } from "../../../styles/tokens";

export function MobilePopoverDivider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderLight,
    marginHorizontal: 6,
    marginVertical: 4,
  },
});
