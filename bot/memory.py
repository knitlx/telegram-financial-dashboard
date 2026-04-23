from collections import defaultdict
from typing import DefaultDict

_store: DefaultDict[int, list[dict]] = defaultdict(list)
MAX_MESSAGES = 30


def get_history(user_id: int) -> list[dict]:
    return list(_store[user_id])


def append(user_id: int, role: str, content: str) -> None:
    _store[user_id].append({"role": role, "content": content})
    if len(_store[user_id]) > MAX_MESSAGES:
        _store[user_id] = _store[user_id][-MAX_MESSAGES:]


def clear(user_id: int) -> None:
    _store[user_id] = []
