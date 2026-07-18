import type { DirectoryPickerUnavailableReason } from "@proliferate/product-client/host/desktop-bridge";

export function directoryPickerUnavailableCopy(
  reason: DirectoryPickerUnavailableReason,
): string {
  return reason === "native_host_required"
    ? "Open the Desktop app to choose a local folder."
    : "The folder picker is unavailable right now. Try again.";
}
