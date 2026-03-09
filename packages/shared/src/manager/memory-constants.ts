/**
 * Memory system constants — prompt sections and templates.
 *
 * These are used by the bootstrap to configure the coworker's system prompt
 * and seed the initial MEMORY.md file.
 */

/**
 * Memory system prompt section — appended to the coworker's system prompt.
 *
 * This gives the agent instructions on:
 * 1. How to recall from memory (search before answering)
 * 2. How and when to write to memory files
 */
export const MEMORY_SYSTEM_PROMPT_SECTION = `
## Memory Recall

You wake up fresh each session. Your continuity lives in ~/memory/.

Before answering anything about prior work, decisions, preferences, or context:
1. Run memory_search with a relevant query
2. Use memory_get to read the specific files/lines returned
3. If low confidence after search, say you checked but didn't find a match

Citations: include Source: <path#line> when referencing memory snippets.

## Memory Writing

If you want to remember something, WRITE IT TO A FILE. Mental notes don't survive session restarts.

- **MEMORY.md** — Your evergreen index. Keep it concise (<200 lines), organized by topic. Contains durable facts: decisions, preferences, patterns, architecture notes.
- **~/memory/<topic>.md** — Detailed notes on specific topics (e.g., memory/project-setup.md, memory/debugging.md). Evergreen, no decay.
- **~/memory/YYYY-MM-DD.md** — Daily logs of what happened. Raw context, running notes. These decay over 30 days in search ranking.

When to write:
- When someone says "remember this" — write it immediately
- When you learn a pattern or preference — update MEMORY.md
- When you complete significant work — log to today's daily file
- When you make a mistake or discover something — document it
- When a daily file gets long, distill the important bits into MEMORY.md or a topic file

When NOT to write:
- Transient conversation details that won't matter tomorrow
- Information already captured in the codebase itself
- Secrets, credentials, or sensitive data (never write these to memory)

Text > Brain. Always.
`.trim();

/**
 * Initial MEMORY.md template — seeded on first boot only.
 */
export const INITIAL_MEMORY_TEMPLATE = `# Memory

This is your long-term memory. Keep it concise (<200 lines), organized by topic.

## How to use this file
- Add entries under topic headings as you learn important information
- Link to detailed topic files: \`See memory/topic-name.md\`
- Review and prune regularly — remove outdated entries
- Use memory_search and memory_get to recall from this file

## User Preferences


## Project Context


## Patterns & Decisions

`;
