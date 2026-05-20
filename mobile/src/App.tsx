import { SafeAreaProvider } from "react-native-safe-area-context";

import { MobileShell } from "./components/shell/MobileShell";
import { MobileAuthProvider } from "./providers/MobileAuthProvider";
import { MobileTelemetryProvider } from "./providers/MobileTelemetryProvider";

export default function App() {
  return (
    <SafeAreaProvider>
      <MobileAuthProvider>
        <MobileTelemetryProvider>
          <MobileShell />
        </MobileTelemetryProvider>
      </MobileAuthProvider>
    </SafeAreaProvider>
  );
}
