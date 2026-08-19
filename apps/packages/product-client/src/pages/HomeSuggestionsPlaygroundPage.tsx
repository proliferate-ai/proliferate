import { HomeSuggestionsPlayground } from "#product/components/playground/HomeSuggestionsPlayground";
// This dev-only route sits outside AuthenticatedProductClient, so load the
// authenticated presentation rules explicitly for direct playground URLs.
import "../app/authenticated.css";

export function HomeSuggestionsPlaygroundPage() {
  return <HomeSuggestionsPlayground />;
}
