#!/usr/bin/env python3
"""Register a classroom SQLite database for link submissions.

Usage:
    python tools/register_database.py bib1 /path/to/bibliothek.db "Bibliothek"

The script:
- verifies that the input is a SQLite database,
- computes its SHA-256 fingerprint,
- gzip-compresses the exact database bytes,
- stores them as Base64 text under databases/,
- adds/updates the short database ID in databases/databases.json.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATABASE_DIR = ROOT / "databases"
REGISTRY_PATH = DATABASE_DIR / "databases.json"


def verify_sqlite(path: Path) -> None:
    try:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
            result = connection.execute("PRAGMA integrity_check").fetchone()
    except sqlite3.Error as exc:
        raise SystemExit(f"Not a valid SQLite database: {exc}") from exc

    if not result or result[0] != "ok":
        raise SystemExit(f"SQLite integrity check failed: {result[0] if result else 'unknown error'}")


def load_registry() -> dict:
    if not REGISTRY_PATH.exists():
        return {"version": 2, "databases": {}}
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Register a SQLite classroom database")
    parser.add_argument("id", help="Short stable ID used in submission links, e.g. bib1")
    parser.add_argument("database", type=Path, help="Path to the SQLite .db file")
    parser.add_argument("title", help="Human-readable title, e.g. Bibliothek")
    args = parser.parse_args()

    database = args.database.expanduser().resolve()
    if not database.is_file():
        raise SystemExit(f"Database file not found: {database}")
    if not args.id or not all(ch.isalnum() or ch in "-_" for ch in args.id):
        raise SystemExit("ID may contain only letters, numbers, '-' and '_'.")

    verify_sqlite(database)
    raw = database.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    compressed = gzip.compress(raw, compresslevel=9)
    encoded = base64.b64encode(compressed).decode("ascii")

    DATABASE_DIR.mkdir(parents=True, exist_ok=True)
    output_name = f"{args.id}.db.gz.b64"
    output_path = DATABASE_DIR / output_name
    output_path.write_text(encoded, encoding="ascii")

    registry = load_registry()
    registry["version"] = 2
    databases = registry.setdefault("databases", {})
    databases[args.id] = {
        "name": database.name,
        "title": args.title,
        "source": f"databases/{output_name}",
        "format": "sqlite-gzip-base64",
        "sha256": digest,
    }
    REGISTRY_PATH.write_text(
        json.dumps(registry, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Registered: {args.id} -> {database.name}")
    print(f"SHA-256:    {digest}")
    print(f"Stored:     {output_path.relative_to(ROOT)}")
    print(f"Size:       {len(raw):,} -> {len(compressed):,} bytes gzip")


if __name__ == "__main__":
    main()
