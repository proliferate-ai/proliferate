import { SafeAreaProvider } from "react-native-safe-area-context";

import { MobileShell } from "./components/shell/MobileShell";
import { MobileAuthProvider } from "./providers/MobileAuthProvider";

export default function App() {
  return (
    <SafeAreaProvider>
      <MobileAuthProvider>
        <MobileShell />
      </MobileAuthProvider>
    </SafeAreaProvider>
  );
}
