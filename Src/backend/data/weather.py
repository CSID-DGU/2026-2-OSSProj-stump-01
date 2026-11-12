"""기상청 ASOS 일자료(서울 지점 108)를 받아 weather 테이블 형식으로 정리한다.

실행 (Src/backend/data 폴더에서):
    python weather.py --load                            # 어제까지 최근 365일 수집 + DB 적재
    python weather.py --start 2025-01-01 --end 2025-12-31 --load
    python weather.py                                   # 수집만

인증키는 Src/.env의 KMA_SERVICE_KEY(일반 인증키 Decoding 값)를 읽는다.
결과는 raw/weather.csv에 저장한다. DB 적재는 (date, region) 기준 upsert라 여러 번 실행해도 중복되지 않는다.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Iterator, Optional

from settings import require_env

# ── 기준값 ──
API_URL = "https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList"
STATION_ID = "108"  # 서울 종관기상관측소. 서울에 ASOS 지점은 이곳 하나다
REGION = "seoul"  # weather.region 값
HEATWAVE_MAX_TEMP = 33.0  # 폭염 기준: 일 최고기온 33℃ 이상
PAGE_SIZE = 999
DEFAULT_DAYS = 365

WEATHER_CSV = Path(__file__).resolve().parent / "raw" / "weather.csv"


@dataclass
class Weather:
    date: str
    region: str
    precipitation_mm: float
    temp_avg: Optional[float]
    temp_max: Optional[float]
    is_heatwave: bool


# ── 순수 함수 ──

def parse_number(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_weather(item: dict) -> Weather:
    """API 응답 한 건을 Weather로 바꾼다."""
    temp_max = parse_number(item.get("maxTa"))
    return Weather(
        date=item["tm"],
        region=REGION,
        # 비가 오지 않은 날은 sumRn이 빈 값으로 온다
        precipitation_mm=parse_number(item.get("sumRn")) or 0.0,
        temp_avg=parse_number(item.get("avgTa")),
        temp_max=temp_max,
        is_heatwave=temp_max is not None and temp_max >= HEATWAVE_MAX_TEMP,
    )


def default_range(today: date) -> tuple[date, date]:
    """어제까지 최근 DEFAULT_DAYS일. 기상청은 전날 자료까지만 준다."""
    end = today - timedelta(days=1)
    return end - timedelta(days=DEFAULT_DAYS - 1), end


# ── 입출력 ──

def fetch_page(key: str, start: date, end: date, page: int) -> dict:
    query = urllib.parse.urlencode({
        "serviceKey": key, "pageNo": page, "numOfRows": PAGE_SIZE, "dataType": "JSON",
        "dataCd": "ASOS", "dateCd": "DAY", "stnIds": STATION_ID,
        "startDt": start.strftime("%Y%m%d"), "endDt": end.strftime("%Y%m%d"),
    })
    try:
        with urllib.request.urlopen(f"{API_URL}?{query}", timeout=30) as res:
            body = res.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        # 오류 메시지에 인증키가 담긴 주소가 찍히지 않도록 상태 코드만 보여 준다
        raise SystemExit(f"기상청 API 호출 실패: HTTP {e.code}") from None
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        # 인증키 오류는 JSON을 요청해도 XML로 온다
        raise SystemExit("기상청 API가 JSON이 아닌 응답을 보냈다(인증키 확인): " + body.replace(key, "***")[:300]) from None
    header = data["response"]["header"]
    if header["resultCode"] != "00":
        raise SystemExit(f"기상청 API 오류 {header['resultCode']}: {header['resultMsg']}")
    return data["response"]["body"]


def fetch(key: str, start: date, end: date) -> Iterator[dict]:
    page = 1
    while True:
        body = fetch_page(key, start, end, page)
        items = body["items"]["item"]
        yield from items
        if page * PAGE_SIZE >= body["totalCount"]:
            return
        page += 1


def load(csv_path: Path = WEATHER_CSV) -> tuple[int, int]:
    """수집한 CSV를 weather 테이블에 넣는다. 같은 날짜·지역은 새 값으로 덮어쓴다(기상청이 값을 고치는 경우가 있다)."""
    from db import connect, copy_csv  # DB 적재 단계에서만 필요해서 여기서 불러온다

    with connect() as conn, conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE weather_src (LIKE weather) ON COMMIT DROP")
        copy_csv(cur, "weather_src", list(Weather.__dataclass_fields__), csv_path)
        cur.execute("""
            INSERT INTO weather SELECT * FROM weather_src
            ON CONFLICT (date, region) DO UPDATE SET
                precipitation_mm = EXCLUDED.precipitation_mm, temp_avg = EXCLUDED.temp_avg,
                temp_max = EXCLUDED.temp_max, is_heatwave = EXCLUDED.is_heatwave
            RETURNING (xmax = 0) AS inserted
        """)
        flags = [is_new for (is_new,) in cur.fetchall()]
    return sum(flags), len(flags) - sum(flags)


def main(argv: Optional[list] = None) -> int:
    start, end = default_range(date.today())
    parser = argparse.ArgumentParser(description="기상청 ASOS 일자료 수집")
    parser.add_argument("--start", type=date.fromisoformat, default=start, help="YYYY-MM-DD")
    parser.add_argument("--end", type=date.fromisoformat, default=end, help="YYYY-MM-DD, 어제까지")
    parser.add_argument("--out", type=Path, default=WEATHER_CSV)
    parser.add_argument("--load", action="store_true", help="수집한 결과를 DB weather 테이블에 넣는다")
    args = parser.parse_args(argv)

    rows = [to_weather(item) for item in fetch(require_env("KMA_SERVICE_KEY"), args.start, args.end)]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(Weather.__dataclass_fields__))
        writer.writeheader()
        writer.writerows(asdict(r) for r in rows)

    print(f"저장: {args.out} ({args.start} ~ {args.end}, {len(rows)}일)")
    print(f"  비 온 날: {sum(r.precipitation_mm > 0 for r in rows)}일, 폭염: {sum(r.is_heatwave for r in rows)}일")

    if args.load:
        inserted, updated = load(args.out)
        print(f"DB 적재: weather 추가 {inserted}일, 갱신 {updated}일")
    return 0


if __name__ == "__main__":
    sys.exit(main())
