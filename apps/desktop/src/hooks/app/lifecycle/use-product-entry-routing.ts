import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { productEntryRoute } from "@/lib/domain/navigation/product-entry-route";

// Owns initial + live host entry delivery into the shared product router.
export function useProductEntryRouting(): void {
  const links = useProductHost().links;
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => links.observeInboundEntries((entry) => {
    const route = productEntryRoute(entry);
    if (route !== null) {
      navigateRef.current(route);
    }
  }), [links]);
}
