import { useMutation } from "@tanstack/react-query";
import {
  sendSupportMessage,
  type SendSupportMessageRequest,
} from "@proliferate/cloud-sdk/client/support";

export function useSendSupportMessage() {
  const mutation = useMutation<void, Error, SendSupportMessageRequest>({
    mutationFn: (input) => sendSupportMessage(input),
  });

  return {
    sendSupportMessage: mutation.mutateAsync,
    isSendingSupportMessage: mutation.isPending,
  };
}
