import type { SessionControlIconKey } from "@proliferate/product-model/chats/session-controls/presentation";
import type { ComponentType, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

interface SessionControlIconProps {
  icon: SessionControlIconKey | null | undefined;
  className?: string;
}

const SESSION_CONTROL_ICONS: Record<SessionControlIconKey, ComponentType<IconProps>> = {
  build: BuildModeFilled,
  chat: MessageSquareFilled,
  claude: ClaudeProviderIcon,
  edit: EditModeFilled,
  opencodeBuild: OpencodeBuildModeFilled,
  opencodePlan: OpencodePlanModeFilled,
  plan: ClipboardListFilled,
  read: ReadModeFilled,
  shieldCheck: ShieldCheckFilled,
  sparkles: ClaudeSparkle,
  zap: ZapFilled,
};

export function SessionControlIcon({
  icon,
  className = "size-3.5",
}: SessionControlIconProps) {
  const Icon = icon ? SESSION_CONTROL_ICONS[icon] : CircleQuestion;
  return <Icon className={className} />;
}

function ClipboardListFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M9.5 2A1.5 1.5 0 0 0 8 3.5v1A1.5 1.5 0 0 0 9.5 6h5A1.5 1.5 0 0 0 16 4.5v-1A1.5 1.5 0 0 0 14.5 2h-5Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M6.5 4.04c-1.25.07-2.05.27-2.62.84C3 5.76 3 7.17 3 10v6c0 2.83 0 4.24.88 5.12C4.76 22 6.17 22 9 22h6c2.83 0 4.24 0 5.12-.88C21 20.24 21 18.83 21 16v-6c0-2.83 0-4.24-.88-5.12c-.57-.57-1.37-.77-2.62-.84v.46a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3v-.46ZM8 11.25a1 1 0 1 1 2 0a1 1 0 0 1-2 0Zm4-.75a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5h-4ZM8 16.25a1 1 0 1 1 2 0a1 1 0 0 1-2 0Zm4-.75a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5h-4Z" />
    </svg>
  );
}

function CircleQuestion({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function ReadModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M6.5 3A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9a1 1 0 0 0-.29-.71l-5-5A1 1 0 0 0 14 3H6.5Zm6.5 1.5V9a1 1 0 0 0 1 1h4.5L13 4.5ZM8.75 12h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5Zm0 3.5h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z" />
    </svg>
  );
}

function EditModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M17.94 2.72a2.55 2.55 0 0 1 3.34 3.34L8.31 19.03a3 3 0 0 1-1.25.75l-4.15 1.18a.75.75 0 0 1-.93-.93l1.18-4.15a3 3 0 0 1 .75-1.25L17.94 2.72Z" />
      <path d="M15.25 5.41 18.6 8.75" className="opacity-45" />
    </svg>
  );
}

function BuildModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M14.9 2.62a2.1 2.1 0 0 1 2.97 0l1.5 1.5a2.1 2.1 0 0 1 0 2.97l-.71.71a1 1 0 0 1-1.42 0l-.52-.52-2.38 2.38 6.28 6.28a2 2 0 0 1 0 2.82l-1.86 1.86a2 2 0 0 1-2.82 0L9.66 14.34l-2.27 2.27.5.5a1 1 0 0 1 0 1.42l-.8.8a2.1 2.1 0 0 1-2.97 0l-1.45-1.45a2.1 2.1 0 0 1 0-2.97l.8-.8a1 1 0 0 1 1.42 0l.5.5 2.27-2.27-.45-.45a2.2 2.2 0 0 1 0-3.11l1.57-1.57a2.2 2.2 0 0 1 3.11 0l.45.45 2.38-2.38-.52-.52a1 1 0 0 1 0-1.42l.7-.72Z" />
    </svg>
  );
}

function OpencodeBuildModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M5.5 4A3.5 3.5 0 0 0 2 7.5v9A3.5 3.5 0 0 0 5.5 20h13a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 18.5 4h-13Zm3.03 5.47 2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 0 1-1.06-1.06L8.94 12l-1.47-1.47a.75.75 0 1 1 1.06-1.06ZM12.75 13.5h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z" />
    </svg>
  );
}

function OpencodePlanModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8.75 2.75A1.75 1.75 0 0 0 7 4.5V5H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3h-1v-.5a1.75 1.75 0 0 0-1.75-1.75h-6.5ZM8.5 6V4.5a.25.25 0 0 1 .25-.25h6.5a.25.25 0 0 1 .25.25V6a.75.75 0 0 1-.75.75h-5.5A.75.75 0 0 1 8.5 6Zm-1.78 5.03a.75.75 0 0 1 1.06-1.06l.72.72 1.72-1.72a.75.75 0 1 1 1.06 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-1.25-1.25ZM13 10.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Zm-5.22 4.22a.75.75 0 0 0-1.06 1.06l1.25 1.25c.3.3.77.3 1.06 0l2.25-2.25a.75.75 0 0 0-1.06-1.06L8.5 15.69l-.72-.72ZM13.75 15h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5Z" />
    </svg>
  );
}

function ShieldCheckFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M11.67 2.08a1 1 0 0 1 .66 0l7 2.5A1 1 0 0 1 20 5.52V11c0 5.2-3.25 8.85-7.65 10.9a.82.82 0 0 1-.7 0C7.25 19.85 4 16.2 4 11V5.52a1 1 0 0 1 .67-.94l7-2.5Zm4.86 7.7a.75.75 0 0 0-1.06-1.06L10.75 13.44l-2.22-2.22a.75.75 0 1 0-1.06 1.06l2.75 2.75c.3.3.77.3 1.06 0l5.25-5.25Z" />
    </svg>
  );
}

function MessageSquareFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M5.5 4A3.5 3.5 0 0 0 2 7.5v7A3.5 3.5 0 0 0 5.5 18H6v2.25a.75.75 0 0 0 1.2.6L11 18h7.5a3.5 3.5 0 0 0 3.5-3.5v-7A3.5 3.5 0 0 0 18.5 4h-13Z" />
    </svg>
  );
}

function ZapFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M14.62 1.6a.75.75 0 0 1 .35.85L12.98 9.75h7.27a.75.75 0 0 1 .55 1.26l-10.5 11.25a.75.75 0 0 1-1.27-.71l1.99-7.3H3.75a.75.75 0 0 1-.55-1.26l10.5-11.25a.75.75 0 0 1 .92-.14Z" />
    </svg>
  );
}

function ClaudeSparkle({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M11.5 2.85a.65.65 0 0 1 1 0l1.66 4.34a2.5 2.5 0 0 0 1.45 1.45l4.34 1.66a.65.65 0 0 1 0 1l-4.34 1.66a2.5 2.5 0 0 0-1.45 1.45l-1.66 4.34a.65.65 0 0 1-1 0l-1.66-4.34a2.5 2.5 0 0 0-1.45-1.45L4.05 11.3a.65.65 0 0 1 0-1l4.34-1.66a2.5 2.5 0 0 0 1.45-1.45L11.5 2.85Z" />
      <path d="M18.75 2.75a.5.5 0 0 1 .5.5v1.5h1.5a.5.5 0 0 1 0 1h-1.5v1.5a.5.5 0 0 1-1 0v-1.5h-1.5a.5.5 0 0 1 0-1h1.5v-1.5a.5.5 0 0 1 .5-.5Z" />
      <path d="M5.25 16.25a.5.5 0 0 1 .5.5v1.5h1.5a.5.5 0 0 1 0 1h-1.5v1.5a.5.5 0 0 1-1 0v-1.5h-1.5a.5.5 0 0 1 0-1h1.5v-1.5a.5.5 0 0 1 .5-.5Z" />
    </svg>
  );
}

function ClaudeProviderIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} fill="currentColor" fillRule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 0 1-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
    </svg>
  );
}
