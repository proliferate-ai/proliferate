from __future__ import annotations


def credential_value_from_payload(payload: dict[str, object], field_name: str) -> str | None:
    secret_fields = payload.get("secretFields")
    if isinstance(secret_fields, dict):
        value = secret_fields.get(field_name)
        if isinstance(value, str) and value:
            return value
    candidate_keys = [field_name]
    if "_" in field_name:
        head, *tail = field_name.split("_")
        candidate_keys.append(head + "".join(part.title() for part in tail))
    elif field_name and any(char.isupper() for char in field_name):
        snake = "".join(
            f"_{char.lower()}" if char.isupper() else char for char in field_name
        ).lstrip("_")
        candidate_keys.append(snake)
    for key in candidate_keys:
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return None
