"""Run the automation worker with ``python -m proliferate.server.automations.worker``."""

from proliferate.server.automations.worker.main import main

if __name__ == "__main__":
    raise SystemExit(main())
