import {
  AuthProviderButton,
  Discord,
  GitHub,
  KeyRound,
  Mail,
} from "@proliferate/ui";

export const SignInStack = () => (
  <div className="flex w-80 flex-col gap-2">
    <AuthProviderButton
      variant="primary"
      icon={<GitHub className="icon-paired" />}
      onClick={() => {}}
    >
      Continue with GitHub
    </AuthProviderButton>
    <AuthProviderButton icon={<Mail className="icon-paired" />} onClick={() => {}}>
      Continue with email
    </AuthProviderButton>
    <AuthProviderButton icon={<Discord className="icon-paired" />} onClick={() => {}}>
      Continue with Discord
    </AuthProviderButton>
  </div>
);

export const Variants = () => (
  <div className="flex w-80 flex-col gap-4">
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-muted-foreground">primary</span>
      <AuthProviderButton
        variant="primary"
        icon={<GitHub className="icon-paired" />}
        onClick={() => {}}
      >
        Continue with GitHub
      </AuthProviderButton>
    </div>
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-muted-foreground">secondary</span>
      <AuthProviderButton
        icon={<KeyRound className="icon-paired" />}
        onClick={() => {}}
      >
        Use a device code instead
      </AuthProviderButton>
    </div>
  </div>
);

export const LoadingAndDisabled = () => (
  <div className="flex w-80 flex-col gap-4">
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-muted-foreground">loading</span>
      <AuthProviderButton variant="primary" loading onClick={() => {}}>
        Connecting to GitHub…
      </AuthProviderButton>
    </div>
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-muted-foreground">disabled</span>
      <AuthProviderButton
        disabled
        icon={<Discord className="icon-paired" />}
        onClick={() => {}}
      >
        Discord sign-in unavailable
      </AuthProviderButton>
    </div>
  </div>
);
