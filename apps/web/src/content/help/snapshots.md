# Snapshots

Snapshots are saved copies of your cloud development environment. Think of them like checkpoints in a video game - you can always come back to where you left off.

## What gets saved?

When you create a snapshot, we capture:

- **All your code changes** - edited files, new files, deleted files
- **Installed dependencies** - npm packages, Python libraries, etc.
- **Database state** - PostgreSQL data, Redis cache
- **Configuration** - environment variables, tool settings
- **Running services** - the exact state of your dev servers

## Why use snapshots?

### Start faster
Instead of waiting for dependencies to install every time, start from a snapshot with everything already set up. New sessions launch in seconds instead of minutes.

### Experiment safely
Try risky changes without fear. If something breaks, just start a new session from your last working snapshot.

### Share setups
Create a snapshot with your preferred tools and configs. Your whole team can use it as a starting point.

## Creating snapshots

During a **setup session**, you can save a snapshot at any time by clicking the camera icon. Give it a name like "Base setup" or "With auth configured" so you can find it later.

## Using snapshots

When you start a new **coding session**, you'll choose which snapshot to use. Pick the one that's closest to what you need - you can always make changes and save a new snapshot.

## Can I skip snapshots?

Yes! If you prefer, you can start coding sessions without a snapshot. Your environment will be set up fresh each time, which takes longer but gives you a clean slate.
