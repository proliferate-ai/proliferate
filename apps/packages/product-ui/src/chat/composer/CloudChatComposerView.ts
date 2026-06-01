import type { SessionControlIconKey } from "@proliferate/product-domain/chats/session-controls/presentation";

export interface CloudChatComposerControlOptionView {
  id: string;
  label: string;
  description?: string | null;
  icon?: SessionControlIconKey | null;
  selected?: boolean;
  disabled?: boolean;
}

export interface CloudChatComposerControlGroupView {
  id: string;
  label?: string | null;
  options: readonly CloudChatComposerControlOptionView[];
}

export interface CloudChatComposerControlView {
  id: string;
  key?: string | null;
  label: string;
  detail?: string | null;
  icon?: "bot" | "brain" | "settings" | SessionControlIconKey;
  placement?: "leading" | "trailing";
  disabled?: boolean;
  active?: boolean;
  pendingState?: "sending" | "queued" | null;
  groups: readonly CloudChatComposerControlGroupView[];
  onSelect?: (optionId: string) => void;
}

export interface CloudChatComposerView {
  value: string;
  placeholder: string;
  disabled?: boolean;
  canSubmit: boolean;
  isSubmitting?: boolean;
  controls?: readonly CloudChatComposerControlView[];
  footerComposerControls?: readonly CloudChatComposerControlView[];
  footerControls?: readonly CloudChatComposerFooterControlView[];
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export interface CloudChatComposerFooterControlView {
  id: string;
  label: string;
  detail?: string | null;
  icon?: "branch" | "cloud" | "external" | "globe" | "repo" | "sparkles" | "users";
  feedback?: "copied";
  feedbackKey?: string | number | null;
  active?: boolean;
  disabled?: boolean;
  pending?: boolean;
  title?: string | null;
  onClick?: () => void | boolean | Promise<void | boolean>;
}

export interface CloudChatComposerControlStripProps {
  controls: readonly CloudChatComposerControlView[];
  disabled?: boolean;
  className?: string;
}
