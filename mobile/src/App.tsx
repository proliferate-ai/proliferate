import { MobileShell } from "./components/shell/MobileShell";
import { MobileAuthProvider } from "./providers/MobileAuthProvider";

export default function App() {
  return (
    <MobileAuthProvider>
      <MobileShell />
    </MobileAuthProvider>
  );
}
