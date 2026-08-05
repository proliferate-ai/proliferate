export interface SecretScopeNoticeProps {
  description: string;
}

export function SecretScopeNotice({ description }: SecretScopeNoticeProps) {
  return (
    <p className="text-body text-muted-foreground">
      {description}
    </p>
  );
}
