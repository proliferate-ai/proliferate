# Setup Sessions

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
- **Iterate** - you can always adjust and save a new snapshot
