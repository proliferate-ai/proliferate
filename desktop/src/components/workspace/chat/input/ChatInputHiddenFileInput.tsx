import { forwardRef, type ChangeEvent } from "react";
import { Input } from "@/components/ui/Input";

const CHAT_INPUT_ATTACHMENT_ACCEPT =
  "image/*,text/*,.md,.json,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.css,.html,.xml,.yaml,.yml,.toml,.sql,.sh";

interface ChatInputHiddenFileInputProps {
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

export const ChatInputHiddenFileInput = forwardRef<
  HTMLInputElement,
  ChatInputHiddenFileInputProps
>(function ChatInputHiddenFileInput({ onChange }, ref) {
  return (
    <Input
      ref={ref}
      type="file"
      multiple
      className="hidden"
      onChange={onChange}
      accept={CHAT_INPUT_ATTACHMENT_ACCEPT}
    />
  );
});
