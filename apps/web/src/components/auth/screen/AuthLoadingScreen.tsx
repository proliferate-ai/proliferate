import { LoadingState } from "@proliferate/product-ui/feedback/LoadingState";

export function AuthLoadingScreen() {
  return (
    <LoadingState
      label="Loading account"
      description="Checking your cloud session."
    />
  );
}
