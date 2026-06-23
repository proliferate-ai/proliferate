import { useSearchParams } from "react-router-dom";

import { AuthErrorScreen } from "../components/auth/screen/AuthErrorScreen";

export function AuthErrorPage() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  return <AuthErrorScreen code={code} />;
}
