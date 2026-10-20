
"""Small SQLite-backed mapping used by the API repositories."""
import os
import pickle
import sqlite3
from collections.abc import MutableMapping, Iterator
from pathlib import Path
from typing import Any


_default_path = Path(__file__).resolve().parents[2] / "data" / "capsules.sqlite3"
DATABASE_PATH = Path(os.getenv("PYTHON_DATABASE_PATH", str(_default_path)))
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)


class PersistentDict(MutableMapping[str, Any]):
    """A dict-compatible SQLite store, keeping existing service code simple."""

    def __init__(self, table: str):
        if not table.replace("_", "").isalnum():
            raise ValueError("Invalid table name")
        self.table = table
        with sqlite3.connect(DATABASE_PATH) as connection:
            connection.execute(
                f'CREATE TABLE IF NOT EXISTS "{table}" '
                "(key TEXT PRIMARY KEY, value BLOB NOT NULL)"
            )
        if os.name != "nt":
            os.chmod(DATABASE_PATH, 0o600)

    def __getitem__(self, key: str) -> Any:
        with sqlite3.connect(DATABASE_PATH) as connection:
            row = connection.execute(
                f'SELECT value FROM "{self.table}" WHERE key = ?', (key,)
            ).fetchone()
        if row is None:
            raise KeyError(key)
        return pickle.loads(row[0])

    def __setitem__(self, key: str, value: Any) -> None:
        serialized = sqlite3.Binary(pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL))
        with sqlite3.connect(DATABASE_PATH) as connection:
            connection.execute(
                f'INSERT INTO "{self.table}" (key, value) VALUES (?, ?) '
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, serialized),
            )

    def __delitem__(self, key: str) -> None:
        with sqlite3.connect(DATABASE_PATH) as connection:
            cursor = connection.execute(
                f'DELETE FROM "{self.table}" WHERE key = ?', (key,)
            )
        if cursor.rowcount == 0:
            raise KeyError(key)

    def __iter__(self) -> Iterator[str]:
        with sqlite3.connect(DATABASE_PATH) as connection:
            rows = connection.execute(f'SELECT key FROM "{self.table}"').fetchall()
        return iter([row[0] for row in rows])

    def __len__(self) -> int:
        with sqlite3.connect(DATABASE_PATH) as connection:
            row = connection.execute(f'SELECT COUNT(*) FROM "{self.table}"').fetchone()
        return int(row[0])
