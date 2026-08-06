"""Shared ORM base class used across all domain model modules."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
