import type { DirectRuntimeConnectionState } from "@/lib/domain/compute/direct-runtime";

/**
 * Presentation vocabulary for direct-runtime attach states. Attach state is a
 * desktop-side claim ("can this Desktop reach the runtime right now"), a
 * different axis from the cloud-plane enrollment status
 * (`computeTargetStatusTone`); both may render side by side. Tones reuse the
 * ui Badge vocabulary so no third tone system appears.
 */

export type DirectRuntimeAttachTone = "success" | "info" | "destructive" | "neutral";

export function directRuntimeAttachStateLabel(
  state: DirectRuntimeConnectionState,
): string {
  switch (state) {
    case "attached":
      return "Attached";
    case "connecting":
      return "Connecting";
    case "unreachable":
      return "Unreachable";
    case "detached":
      return "Detached";
  }
}

export function directRuntimeAttachStateTone(
  state: DirectRuntimeConnectionState,
): DirectRuntimeAttachTone {
  switch (state) {
    case "attached":
      return "success";
    case "connecting":
      return "info";
    case "unreachable":
      return "destructive";
    case "detached":
      return "neutral";
  }
}

/**
 * Configure-while-offline is allowed everywhere (design §6.4): edits store
 * unconditionally and the push happens on the next attach. Surfaces show this
 * note whenever the edited runtime is not currently attached.
 */
export function directRuntimeEditsDeferred(
  state: DirectRuntimeConnectionState,
): boolean {
  return state !== "attached";
}

/**
 * "This Mac" display name from the OS hostname; macOS reports
 * `Name.local`, which reads better without the mDNS suffix.
 */
export function loopbackDisplayNameFromHostname(
  hostname: string | null | undefined,
): string {
  const trimmed = hostname?.trim().replace(/\.local$/i, "");
  return trimmed || "This Mac";
}
