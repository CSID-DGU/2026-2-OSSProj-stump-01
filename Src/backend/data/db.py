"""정리한 CSV를 DB에 넣을 때 쓰는 공통 함수."""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

import psycopg

from settings import database_url

COPY_CHUNK = 1024 * 1024


def connect() -> psycopg.Connection:
    try:
        return psycopg.connect(database_url())
    except psycopg.OperationalError as e:
        raise SystemExit(f"DB에 접속하지 못했다. Src 폴더에서 `docker compose up -d`로 DB를 켰는지 확인한다.\n{e}") from None


def copy_csv(cur: psycopg.Cursor, table: str, columns: Sequence[str], csv_path: Path) -> None:
    """CSV(첫 줄은 컬럼 이름)를 COPY로 한 번에 넣는다. 빈 칸은 NULL이 된다."""
    cols = ", ".join(columns)
    with cur.copy(f"COPY {table} ({cols}) FROM STDIN WITH (FORMAT csv, HEADER true)") as copy:
        with csv_path.open("rb") as f:
            while chunk := f.read(COPY_CHUNK):
                copy.write(chunk)
