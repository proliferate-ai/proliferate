import { UserAvatar } from "@proliferate/ui";

export const Initials = () => (
  <div className="flex items-center gap-3">
    <UserAvatar displayName="Jane Doe" className="size-8" />
    <UserAvatar displayName="Pablo Sanchez" className="size-8" />
    <UserAvatar displayName="Ada Lovelace" className="size-8" />
  </div>
);

export const Sizes = () => (
  <div className="flex items-center gap-3">
    <UserAvatar displayName="Jane Doe" className="size-6" />
    <UserAvatar displayName="Jane Doe" className="size-8" />
    <UserAvatar displayName="Jane Doe" className="size-10" />
  </div>
);
