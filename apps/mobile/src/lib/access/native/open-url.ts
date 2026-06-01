import { Linking } from "react-native";

export function openNativeUrl(url: string): Promise<void> {
  return Linking.openURL(url);
}
