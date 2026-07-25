import { useMemo, useSyncExternalStore } from "react";

import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";
import {
  isSessionReplacementTombstoneAuthorityCurrent,
  readSessionReplacementTombstoneAuthoritySnapshot,
  subscribeSessionReplacementTombstoneAuthority,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-authority";

export function useSessionReplacementTombstoneAuthority() {
  const persistence = useProductStorageContext();
  const authority = useSyncExternalStore(
    subscribeSessionReplacementTombstoneAuthority,
    readSessionReplacementTombstoneAuthoritySnapshot,
    readSessionReplacementTombstoneAuthoritySnapshot,
  );
  return useMemo(() => (
    isSessionReplacementTombstoneAuthorityCurrent(persistence.storage)
      ? authority
      : { hydrated: false, revision: authority.revision }
  ), [authority, persistence]);
}
