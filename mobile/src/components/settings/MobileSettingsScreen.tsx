import { StyleSheet, Text, View } from "react-native";

import { MobileGlyph } from "../primitives/MobileGlyph";
import {
  MobileCard,
  MobileCardTitle,
  MobileScreen,
  MobileScreenHeader,
  MobileStack,
} from "../primitives/MobileLayout";
import { spacing, text } from "../../styles/tokens";

export function MobileSettingsScreen() {
  return (
    <MobileScreen>
      <MobileStack>
        <MobileScreenHeader
          eyebrow="Settings"
          title="Account and cloud"
          description="Heavy configuration still lives in Web and Desktop."
        />

        <MobileCard style={styles.card}>
          <MobileGlyph tone="info">G</MobileGlyph>
          <View style={styles.cardBody}>
            <MobileCardTitle>GitHub connected</MobileCardTitle>
            <Text style={text.caption}>Cloud workspaces require the product account to have GitHub attached.</Text>
          </View>
        </MobileCard>

        <MobileCard style={styles.card}>
          <MobileGlyph tone="muted">M</MobileGlyph>
          <View style={styles.cardBody}>
            <MobileCardTitle>MCPs and skills</MobileCardTitle>
            <Text style={text.caption}>Public team tools are configured from Web or Desktop.</Text>
          </View>
        </MobileCard>

        <MobileCard style={styles.card}>
          <MobileGlyph tone="success">T</MobileGlyph>
          <View style={styles.cardBody}>
            <MobileCardTitle>TestFlight build</MobileCardTitle>
            <Text style={text.caption}>Bundle id ai.proliferate.mobile is ready for iOS distribution.</Text>
          </View>
        </MobileCard>
      </MobileStack>
    </MobileScreen>
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
});
