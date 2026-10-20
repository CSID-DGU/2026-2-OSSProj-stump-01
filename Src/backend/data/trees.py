"""서울시 가로수 위치 정보(OA-22904)를 내려받아 정리한다.

실행 (Src/backend/data 폴더에서):
    python trees.py --download    # 원본 xlsx 내려받기 + 정리
    python trees.py               # 이미 받은 원본으로 정리만

결과는 raw/trees_clean.csv에 저장한다. 원본과 결과 모두 공공누리 제4유형이라 커밋하지 않는다(raw/는 .gitignore에 있음).
DB 적재는 마이그레이션(#17)이 생기면 이 파일에 이어서 붙인다.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Iterator, Optional

# ── 기준값 ──
DATASET_PAGE = "https://data.seoul.go.kr/dataList/OA-22904/S/1/datasetView.do"
DOWNLOAD_URL = "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false"
# 데이터셋 페이지의 내려받기 버튼이 보내는 값. 파일이 새 연도판으로 바뀌면 seq가 달라질 수 있다.
DOWNLOAD_FORM = {"infId": "OA-22904", "seqNo": "", "seq": "2", "infSeq": "1"}

RAW_DIR = Path(__file__).resolve().parent / "raw"
RAW_XLSX = RAW_DIR / "trees2026.xlsx"
CLEAN_CSV = RAW_DIR / "trees_clean.csv"

HEADER_ROWS = 3  # 시트마다 제목, "관리청: ○○구", 컬럼 이름 3줄이 먼저 나온다
EXCLUDED_SPECIES = {"공분"}  # 나무가 없는 빈 식재 자리로 보인다(ERD.md 참고)
COORD_DECIMALS = 7  # source_key를 만들 때 좌표 자릿수. 원본이 소수점 7~9자리라 7자리(약 1cm)로 맞춘다
SEOUL_BBOX = (126.7, 37.4, 127.3, 37.75)  # 경도 최소, 위도 최소, 경도 최대, 위도 최대

JIBUN_RE = re.compile(r"^서울특별시\s+(\S+구)\s+(\S+)")


@dataclass
class Tree:
    source_key: str
    species: str
    lon: float
    lat: float
    agency: str
    district: Optional[str]
    dong: Optional[str]
    road_name: Optional[str]
    address: Optional[str]


# ── 순수 함수: 한 행을 정리하는 규칙 ──

def clean_text(value) -> Optional[str]:
    """앞뒤·중복 공백을 없애고, 빈 문자열은 None으로 바꾼다."""
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text or None


def parse_coord(value) -> Optional[float]:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def in_seoul(lon: float, lat: float) -> bool:
    min_lon, min_lat, max_lon, max_lat = SEOUL_BBOX
    return min_lon < lon < max_lon and min_lat < lat < max_lat


def parse_address(address: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """'서울특별시 마포구 공덕동 111-129' → ('마포구', '공덕동').

    지번 주소면 구와 법정동을 모두 얻고, 도로명 주소면 두 번째 값이 도로명이라 구만 쓴다.
    """
    if not address:
        return None, None
    m = JIBUN_RE.match(address)
    if not m:
        return None, None
    gu, second = m.groups()
    # 법정동은 '공덕동', '보문동1가', '종로1가'처럼 '동' 또는 '가'로 끝난다
    return gu, (second if second.endswith(("동", "가")) else None)


def make_source_key(agency: str, lon: float, lat: float) -> str:
    return f"{agency}|{lon:.{COORD_DECIMALS}f}|{lat:.{COORD_DECIMALS}f}"


def to_tree(row: tuple) -> tuple[Optional[Tree], Optional[str]]:
    """원본 한 행을 Tree로 바꾼다. 버리는 행이면 (None, 버린 이유)를 돌려준다."""
    agency, road, species, road_addr, jibun, lon, lat = (list(row) + [None] * 7)[:7]
    agency, road, species = clean_text(agency), clean_text(road), clean_text(species)
    road_addr, jibun = clean_text(road_addr), clean_text(jibun)

    if not agency:
        return None, "빈 행"
    if species in EXCLUDED_SPECIES:
        return None, f"수종 제외({species})"
    lon_f, lat_f = parse_coord(lon), parse_coord(lat)
    if lon_f is None or lat_f is None:
        return None, "좌표 없음"
    if not in_seoul(lon_f, lat_f):
        return None, "좌표가 서울 밖"

    # 구·동은 나무가 서 있는 위치 기준이다. 관리청(agency)과 다를 수 있다.
    district, dong = parse_address(jibun)
    if district is None:
        district, _ = parse_address(road_addr)
    if district is None and agency.endswith("구"):
        # 주소가 비어 있으면 관리 자치구로 대신한다. 다른 구에 서 있는 나무는 0.5% 정도라 오차가 작다.
        district = agency

    tree = Tree(
        source_key=make_source_key(agency, lon_f, lat_f),
        species=species or "미상",
        lon=round(lon_f, COORD_DECIMALS),
        lat=round(lat_f, COORD_DECIMALS),
        agency=agency,
        district=district,
        dong=dong,
        road_name=road,
        address=jibun or road_addr,
    )
    return tree, None


def dedupe(trees: Iterable[Tree], stats: Counter) -> Iterator[Tree]:
    """source_key가 같은 행은 처음 것만 남긴다."""
    seen = set()
    for tree in trees:
        if tree.source_key in seen:
            stats["중복 좌표"] += 1
            continue
        seen.add(tree.source_key)
        yield tree


# ── 입출력 ──

def download(dest: Path = RAW_XLSX) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = urllib.parse.urlencode(DOWNLOAD_FORM).encode()
    req = urllib.request.Request(DOWNLOAD_URL, data=data, headers={"Referer": DATASET_PAGE})
    with urllib.request.urlopen(req, timeout=120) as res:
        body = res.read()
    if not body.startswith(b"PK"):  # xlsx는 zip 파일이라 PK로 시작한다
        raise RuntimeError("xlsx가 아닌 응답을 받았다. 데이터셋 페이지에서 파일이 바뀌었는지 확인한다: " + DATASET_PAGE)
    dest.write_bytes(body)
    print(f"내려받음: {dest} ({len(body) / 1024 / 1024:.1f}MB)")


def read_rows(xlsx: Path) -> Iterator[tuple]:
    import openpyxl  # 정리 단계에서만 필요해서 여기서 불러온다

    wb = openpyxl.load_workbook(xlsx, read_only=True)
    try:
        for ws in wb.worksheets:
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i >= HEADER_ROWS:
                    yield row
    finally:
        wb.close()


def clean(xlsx: Path = RAW_XLSX, out: Path = CLEAN_CSV) -> Counter:
    stats: Counter = Counter()

    def converted() -> Iterator[Tree]:
        for row in read_rows(xlsx):
            stats["원본 행"] += 1
            tree, reason = to_tree(row)
            if tree is None:
                stats[reason] += 1
            else:
                yield tree

    fields = list(Tree.__dataclass_fields__)
    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for tree in dedupe(converted(), stats):
            writer.writerow(asdict(tree))
            stats["저장"] += 1
            if tree.dong is None:
                stats["(저장 중) 동 없음"] += 1
    return stats


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(description="서울시 가로수 위치 정보 정리")
    parser.add_argument("--download", action="store_true", help="원본 xlsx를 먼저 내려받는다")
    parser.add_argument("--xlsx", type=Path, default=RAW_XLSX)
    parser.add_argument("--out", type=Path, default=CLEAN_CSV)
    args = parser.parse_args(argv)

    if args.download:
        download(args.xlsx)
    if not args.xlsx.exists():
        print(f"원본이 없다: {args.xlsx}\n--download 옵션으로 내려받는다.", file=sys.stderr)
        return 1

    stats = clean(args.xlsx, args.out)
    print(f"저장: {args.out}")
    for key, count in stats.most_common():
        print(f"  {key}: {count:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
