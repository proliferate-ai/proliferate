# Steering

Status: target

A prompt delivered into a running child session, attributed to the steering
subject (the parent agent or a person). Steering is the courier primitive
pointed inward: same idempotent prompt delivery, same attribution rules, no
new transport.

No dedicated code exists yet; today's nearest mechanics are the pending-prompt
queue and subagent completion delivery in the owner spec
([README.md](README.md)).

> [!decision] PABLO DECIDES: whether a steering prompt interrupts the child's
> current turn or queues behind it, and whether children may steer parents.
