import { StyleSheet, Text, View } from "react-native";

import { MobileGlyph } from "../primitives/MobileGlyph";
import {
  MobileCard,
  MobileCardTitle,
  MobileScreen,
  MobileScreenHeader,
  MobileSectionHeader,
  MobileStack,
} from "../primitives/MobileLayout";
import { workspaces } from "../../lib/fixtures/mobile-fixtures";
import { spacing, text } from "../../styles/tokens";

export function MobileWorkspacesScreen() {
  const sharedWorkspaces = workspaces.filter((workspace) => workspace.kind === "shared");
  const personalWorkspaces = workspaces.filter((workspace) => workspace.kind !== "shared");

  return (
    <MobileScreen>
      <MobileStack>
        <MobileScreenHeader eyebrow="Workspaces" title="Cloud sandboxes" />

        <MobileSectionHeader title="Shared" meta={sharedWorkspaces.length.toString()} />
        {sharedWorkspaces.map((workspace) => (
          <WorkspaceRow key={workspace.id} workspace={workspace} />
        ))}

        <MobileSectionHeader title="Personal" meta={personalWorkspaces.length.toString()} />
        {personalWorkspaces.map((workspace) => (
          <WorkspaceRow key={workspace.id} workspace={workspace} />
        ))}
      </MobileStack>
    </MobileScreen>
  );
}

function WorkspaceRow({ workspace }: { workspace: (typeof workspaces)[number] }) {
  return (
    <MobileCard style={styles.card}>
      <MobileGlyph tone={workspace.kind === "shared" ? "info" : "muted"}>
        {workspace.kind === "shared" ? "T" : "P"}
      </MobileGlyph>
      <View style={styles.cardBody}>
        <MobileCardTitle>{workspace.name}</MobileCardTitle>
        <Text style={text.caption}>{workspace.repoLabel}</Text>
        <Text style={styles.branch}>{workspace.branchLabel}</Text>
      </View>
    </MobileCard>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: spacing[3],
  },
  cardBody: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1],
  },
  branch: {
    color: text.caption.color,
    fontSize: 12,
  },
});
