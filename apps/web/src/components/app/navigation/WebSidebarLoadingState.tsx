export function SidebarLoadingState() {
  return (
    <div className="flex flex-col gap-1 py-1" aria-label="Loading cloud workspaces" role="status">
      <SkeletonBlock className="h-7 w-full bg-sidebar-accent" />
      <SkeletonBlock className="h-7 w-[82%] bg-sidebar-accent/80" />
      <SkeletonBlock className="h-7 w-[68%] bg-sidebar-accent/70" />
      <span className="sr-only">Loading cloud workspaces</span>
    </div>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-md bg-sidebar-accent motion-safe:animate-pulse ${className ?? ""}`}
    />
  );
}
