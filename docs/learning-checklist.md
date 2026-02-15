# Proliferate — Subsystem Learning Checklist

- [ ] Auth & Orgs
- [ ] Integrations
- [ ] Repos & Prebuilds
- [ ] Secrets & Environment
- [ ] Sandbox Providers
- [ ] Sessions & Gateway
- [ ] Agent Contract
- [ ] Automations & Triggers
- [ ] Actions
- [ ] LLM Proxy
- [ ] Billing & Metering
- [ ] CLI
- [ ] UX flows overall

## Prompt Template

```
I want to deeply understand the ___ subsystem(s) in our codebase. Walk me through them as a guided learning session, building from subsystem to subsystem.

Start with a high-level overview: the relevant specs (verify they're current), the overall file tree (use tree diagrams), and the mental model. Then identify the core components I need to understand in order (A, B, C, D...).

For each component: explain what it does, show the relevant file tree, and point me to the specific files I should read (in order). Don't move on to the next component until I say I understand. After all components, tie it back together with an end-to-end trace.

At the end, give me a "Comprehension Check" — a list of the most important questions I should be able to answer and concepts I should be able to explain if I truly understand this subsystem. These should cover: key design decisions (why it works this way), invariants (what must always be true), data flow (what happens when X), failure modes (what happens when Y breaks), and boundary knowledge (where this subsystem ends and others begin).
```
