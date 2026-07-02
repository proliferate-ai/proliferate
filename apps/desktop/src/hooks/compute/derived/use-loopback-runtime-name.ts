import { useEffect, useState } from "react";
import { getOsHostname } from "@/lib/access/tauri/os";
import { loopbackDisplayNameFromHostname } from "@/lib/domain/compute/direct-runtime-presentation";

/** Display name for this machine's loopback runtime ("This Mac" fallback). */
export function useLoopbackRuntimeDisplayName(): string {
  const [hostname, setHostname] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getOsHostname().then((value) => {
      if (!cancelled) {
        setHostname(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return loopbackDisplayNameFromHostname(hostname);
}
