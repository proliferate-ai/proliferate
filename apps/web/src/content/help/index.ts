// Help topics registry
// Add new topics here and update the content map below

export type HelpTopic = "getting-started" | "snapshots" | "setup-sessions" | "coding-sessions";

export interface HelpTopicMeta {
	id: HelpTopic;
	title: string;
	description: string;
}

export const helpTopics: Record<HelpTopic, HelpTopicMeta> = {
	"getting-started": {
		id: "getting-started",
		title: "Getting Started",
		description: "Learn the basics of cloud development",
	},
	snapshots: {
		id: "snapshots",
		title: "Snapshots",
		description: "Save and restore your development environment",
	},
	"setup-sessions": {
		id: "setup-sessions",
		title: "Setup Sessions",
		description: "Configure your environment with AI assistance",
	},
	"coding-sessions": {
		id: "coding-sessions",
		title: "Coding Sessions",
		description: "Build and debug with an AI coding agent",
	},
};

// Help content stored as string constants
// The .md files are kept for reference/editing, but content is embedded here for runtime
const helpContent: Record<HelpTopic, string> = {
	"getting-started": `# Getting Started

Welcome! Here's how to go from zero to coding in the cloud.

## The basic flow

1. **Connect your repo** - Link a GitHub repository you want to work on
2. **Set up your environment** - Run a setup session to install dependencies and configure services
3. **Save a snapshot** - Capture your configured environment so you can reuse it
4. **Start coding** - Launch coding sessions from your snapshot and build with AI

## Your first time

### 1. Add a repository

Click **Add Repo** and connect your GitHub account. Pick a repository - we'll clone it to your cloud environment.

### 2. Run setup

Click **Set Up** on your repo. An AI agent helps you install dependencies, configure databases, and get everything running. This usually takes a few minutes.

### 3. Save a snapshot

When setup is complete, save a snapshot. Give it a name like "Initial setup" - you'll use this to start coding sessions.

### 4. Start coding

Click **New Session**, pick your snapshot, and start building. The AI agent can write code, debug issues, run tests, and more.

## Need help?

- Click the **?** icon anywhere to learn more about that feature
- Check out the other help topics in this menu`,

	snapshots: `# Snapshots

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

Yes! If you prefer, you can start coding sessions without a snapshot. Your environment will be set up fresh each time, which takes longer but gives you a clean slate.`,

	"setup-sessions": `# Setup Sessions

Setup sessions are where you configure your cloud development environment before you start coding.

## What happens in a setup session?

Our AI agent helps you:

1. **Install dependencies** - npm, pip, cargo, whatever your project needs
2. **Configure services** - databases, caches, queues
3. **Set up tools** - linters, formatters, test runners
4. **Verify everything works** - run your tests, start your dev server

## How it works

Just tell the agent what you need in plain English:

> "Install all dependencies and make sure the tests pass"

> "Set up PostgreSQL and run the database migrations"

> "Configure the project for local development"

The agent reads your project files, figures out what to do, and sets everything up. You can watch it work and ask questions along the way.

## Saving your work

When your environment is ready, save a snapshot. This captures everything so you don't have to repeat the setup next time.

## Tips

- **Be specific** - "Install Node 20" is better than "install node"
- **Check the logs** - if something fails, the error messages help the agent fix it
- **Iterate** - you can always adjust and save a new snapshot`,

	"coding-sessions": `# Coding Sessions

Coding sessions are where the real work happens. You have a fully configured cloud environment and an AI agent ready to help you build.

## Starting a session

Pick a snapshot to start from, and you'll have a ready-to-go environment in seconds. All your dependencies are installed, services are running, and you can start coding immediately.

## What you can do

### Write code together
Describe what you want to build, and the agent writes the code. You can be as high-level ("add user authentication") or specific ("add a logout button to the header") as you like.

### Debug issues
Paste an error message or describe unexpected behavior. The agent investigates, finds the problem, and fixes it.

### Explore the codebase
Ask questions about how things work. The agent reads your code and explains it.

### Run commands
Tests, builds, migrations - the agent can run any command and handle the results.

## The preview panel

When you're building something with a UI, the preview panel shows your changes live. Click the preview icon in the header to toggle it.

## Pausing and resuming

Sessions automatically pause when you're away to save resources. When you come back, just click Resume - your environment is restored exactly as you left it.

## Tips

- **Be direct** - "Fix the login bug" works better than "I think there might be an issue with logging in maybe"
- **Give context** - "The signup form should validate email format" is clearer than "add validation"
- **Iterate** - start simple, see the result, then refine`,
};

export function getHelpContent(topic: HelpTopic): string {
	return helpContent[topic] || "# Help topic not found";
}
