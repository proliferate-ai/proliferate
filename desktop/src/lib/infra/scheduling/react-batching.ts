import { unstable_batchedUpdates } from "react-dom";

export function batchSessionStoreWrites(fn: () => void): void {
  unstable_batchedUpdates(fn);
}
