"""기상청 ASOS 일자료(서울 지점 108)를 받아 weather 테이블 형식으로 정리한다.

실행 (Src/backend/data 폴더에서):
    python weather.py                                   # 어제까지 최근 365일
    python weather.py --start 2025-01-01 --end 2025-12-31

인증키는 Src/.env의 KMA_SERVICE_KEY(일반 인증키 Decoding 값)를 읽는다.
결과는 raw/weather.csv에 저장한다. DB 적재는 마이그레이션(#17)이 생기면 이어서 붙인다.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Iterator, Optional

# ── 기준값 ──
API_URL = "https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList"
STATION_ID = "108"  # 서울 종관기상관측소. 서울에 ASOS 지점은 이곳 하나다
REGION = "seoul"  # weather.region 값
HEATWAVE_MAX_TEMP = 33.0  # 폭염 기준: 일 최고기온 33℃ 이상
PAGE_SIZE = 999
DEFAULT_DAYS = 365

DATA_DIR = Path(__file__).resolve().parent
ENV_FILE = DATA_DIR.parent.parent / ".env"  # Src/.env
WEATHER_CSV = DATA_DIR / "raw" / "weather.csv"


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

def read_service_key() -> str:
    key = os.environ.get("KMA_SERVICE_KEY")
    if not key and ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "KMA_SERVICE_KEY":
                key = value.strip().strip('"')
    if not key:
        raise SystemExit(f"KMA_SERVICE_KEY가 비어 있다. {ENV_FILE}에 넣는다.")
    return key


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


def main(argv: Optional[list] = None) -> int:
    start, end = default_range(date.today())
    parser = argparse.ArgumentParser(description="기상청 ASOS 일자료 수집")
    parser.add_argument("--start", type=date.fromisoformat, default=start, help="YYYY-MM-DD")
    parser.add_argument("--end", type=date.fromisoformat, default=end, help="YYYY-MM-DD, 어제까지")
    parser.add_argument("--out", type=Path, default=WEATHER_CSV)
    args = parser.parse_args(argv)

    rows = [to_weather(item) for item in fetch(read_service_key(), args.start, args.end)]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(Weather.__dataclass_fields__))
        writer.writeheader()
        writer.writerows(asdict(r) for r in rows)

    print(f"저장: {args.out} ({args.start} ~ {args.end}, {len(rows)}일)")
    print(f"  비 온 날: {sum(r.precipitation_mm > 0 for r in rows)}일, 폭염: {sum(r.is_heatwave for r in rows)}일")
    return 0


if __name__ == "__main__":
    sys.exit(main())
