"""Append-only JSON records keyed by race and purpose."""
from hashlib import sha256
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from .source import encode


def store_once(directory, key, value):
    filename = ledger_path(directory, key)
    directory.mkdir(parents=True, exist_ok=True)
    # Link the completed temporary file atomically. A retry cannot replace an existing observation.
    with NamedTemporaryFile(dir=directory, delete=False) as temporary:
        tmp = Path(temporary.name)
        temporary.write(encode(value) + b"\n")
    try:
        os.link(tmp, filename)
    finally:
        tmp.unlink()
    return filename


def ledger_path(directory, key):
    return directory / (sha256(key.encode()).hexdigest() + ".json")
