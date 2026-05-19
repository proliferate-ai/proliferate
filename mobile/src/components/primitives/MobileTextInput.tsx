import { StyleSheet, TextInput, type TextInputProps } from "react-native";

import { colors, radius } from "../../styles/tokens";

export function MobileTextInput(props: TextInputProps) {
  return (
    <TextInput
      {...props}
      placeholderTextColor={props.placeholderTextColor ?? colors.faint}
      style={[styles.input, props.multiline && styles.multiline, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.input,
    backgroundColor: colors.card,
    color: colors.fg,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  multiline: {
    minHeight: 112,
    paddingTop: 12,
    textAlignVertical: "top",
  },
});
