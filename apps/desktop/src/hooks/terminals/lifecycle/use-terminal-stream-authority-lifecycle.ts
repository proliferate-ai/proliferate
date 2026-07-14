import { useEffect } from "react";
import { useCloudConnectionAuthority } from "@/hooks/access/cloud/use-cloud-connection-authority";
import { retireCloudTerminalStreamsOutsideAuthority } from "@/lib/infra/terminals/terminal-stream-registry";

/** Retires live cloud terminal sockets when ProductHost authority changes. */
export function useTerminalStreamAuthorityLifecycle(): void {
  const { scopeKey } = useCloudConnectionAuthority();

  useEffect(() => {
    retireCloudTerminalStreamsOutsideAuthority(scopeKey);
  }, [scopeKey]);
}
