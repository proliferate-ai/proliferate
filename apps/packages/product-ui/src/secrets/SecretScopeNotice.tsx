export interface SecretScopeNoticeProps {
  description: string;
}

export function SecretScopeNotice({ description }: SecretScopeNoticeProps) {
  return (
    <p className="text-sm leading-5 text-muted-foreground">
      {description}
    </p>
  );
}
