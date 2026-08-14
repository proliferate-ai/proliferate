import type { ContentPart } from "@anyharness/sdk";
import {
  localPathToFileUri,
  type PromptAttachmentSnapshot,
} from "./prompt-attachment-snapshot";

/**
 * Project submitted attachment snapshots into optimistic transcript content
 * parts. Lives apart from the snapshot model because only the composer's
 * submit path renders this projection — keeping it out of the login-route
 * chunk, which carries the snapshot model via prompt dispatch.
 */
export function promptAttachmentSnapshotsToContentParts(
  snapshots: readonly PromptAttachmentSnapshot[],
): ContentPart[] {
  return snapshots.map((snapshot): ContentPart => {
    if (snapshot.kind === "image") {
      return {
        type: "image",
        attachmentId: snapshot.id,
        mimeType: snapshot.mimeType,
        name: snapshot.name,
        size: snapshot.size,
        source: snapshot.source,
      };
    }
    if (snapshot.kind === "local_ref") {
      return {
        type: "resource_link",
        uri: localPathToFileUri(snapshot.localPath ?? snapshot.name),
        name: snapshot.name,
        mimeType: snapshot.mimeType || null,
        size: snapshot.pathKind === "directory" ? null : snapshot.size,
      };
    }
    return {
      type: "resource",
      attachmentId: snapshot.id,
      uri: `file://${snapshot.name}`,
      name: snapshot.name,
      mimeType: snapshot.mimeType,
      size: snapshot.size,
      source: snapshot.source,
    };
  });
}
