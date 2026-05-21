import { SafeAreaProvider } from "react-native-safe-area-context";

import { MobileShell } from "./components/shell/MobileShell";
import { MobileAuthProvider } from "./providers/MobileAuthProvider";
import { MobileCloudProvider } from "./providers/MobileCloudProvider";
import { MobileTelemetryProvider } from "./providers/MobileTelemetryProvider";

export default function App() {
  return (
    <SafeAreaProvider>
      <MobileAuthProvider>
        <MobileTelemetryProvider>
          <MobileCloudProvider>
            <MobileShell />
          </MobileCloudProvider>
        </MobileTelemetryProvider>
      </MobileAuthProvider>
    </SafeAreaProvider>
  );
}
