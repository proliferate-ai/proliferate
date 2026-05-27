import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelTeamCheckout,
  createTeamCheckoutSession,
  getCurrentTeamCheckout,
} from "@proliferate/cloud-sdk/client/billing";
import { desktopBillingReturnOptions } from "@/lib/access/cloud/billing-return";

const TEAM_CHECKOUT_CURRENT_QUERY_KEY = ["cloud", "billing", "team-checkout", "current"] as const;

export function useCurrentTeamCheckout(enabled: boolean) {
  return useQuery({
    queryKey: TEAM_CHECKOUT_CURRENT_QUERY_KEY,
    queryFn: () => getCurrentTeamCheckout(),
    enabled,
  });
}

export function useTeamCheckoutActions() {
  const queryClient = useQueryClient();

  const invalidateCurrentTeamCheckout = async () => {
    await queryClient.invalidateQueries({ queryKey: TEAM_CHECKOUT_CURRENT_QUERY_KEY });
  };

  const createTeamCheckoutMutation = useMutation({
    mutationFn: (teamName: string) => createTeamCheckoutSession({
      teamName,
      inviteEmails: [],
      ...desktopBillingReturnOptions(),
    }),
    onSuccess: invalidateCurrentTeamCheckout,
  });

  const cancelTeamCheckoutMutation = useMutation({
    mutationFn: (intentId: string) => cancelTeamCheckout(intentId),
    onSuccess: invalidateCurrentTeamCheckout,
  });

  return {
    createTeamCheckout: createTeamCheckoutMutation.mutateAsync,
    cancelTeamCheckout: cancelTeamCheckoutMutation.mutateAsync,
    resetCreateTeamCheckout: createTeamCheckoutMutation.reset,
    creatingTeamCheckout: createTeamCheckoutMutation.isPending,
    cancelingTeamCheckout: cancelTeamCheckoutMutation.isPending,
    createTeamCheckoutError: createTeamCheckoutMutation.error,
  };
}
