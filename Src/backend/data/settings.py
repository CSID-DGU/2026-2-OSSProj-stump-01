"""Src/.env 값을 읽는다. 환경변수가 있으면 그 값을 먼저 쓴다."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"  # Src/.env


def read_env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.environ.get(name)
    if value:
        return value
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            key, _, val = line.partition("=")
            if key.strip() == name:
                val = val.strip().strip('"')
                if val:
                    return val
    return default


def require_env(name: str) -> str:
    value = read_env(name)
    if not value:
        raise SystemExit(f"{name}가 비어 있다. {ENV_FILE}에 넣는다.")
    return value


def database_url() -> str:
    """로컬 docker compose DB 접속 주소. 컨테이너 밖(내 컴퓨터)에서 접속하므로 localhost를 쓴다."""
    user = require_env("POSTGRES_USER")
    password = require_env("POSTGRES_PASSWORD")
    db = require_env("POSTGRES_DB")
    host = read_env("POSTGRES_HOST", "localhost")
    port = read_env("POSTGRES_PORT", "5432")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"
