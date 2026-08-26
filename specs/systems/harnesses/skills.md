# Skills

Status: target

Skill definitions as data — versioned instruction packages an agent loads at
launch or on demand — plus the loader that applies them to a harness process.
The catalog unit ships like the agent catalog (`catalogs/skills/`): versioned,
immutable, grants attached at enable-time, zero platform code per new skill.

No code exists yet. Owner spec: [README.md](README.md). Product policy
starting material: [prompt-and-skill-policy.md](prompt-and-skill-policy.md).

> [!decision] PABLO DECIDES: the skill unit's shape (single instruction file
> vs package with resources), where enable-state lives (org vs user), and
> whether skills may carry tool grants.
