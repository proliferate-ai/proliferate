"""Function-invocation CRUD settings surface (track 1b phase 3).

Moved into its own subpackage (rather than ``function_invocations_*.py`` flat
modules alongside ``integrations/service.py``) to satisfy the repo's
``SERVICE_SUFFIX_MODULE`` boundary rule (no ``*_service.py`` module names) while
keeping the settings CRUD logically separate from the main integrations
service it sits next to.
"""
