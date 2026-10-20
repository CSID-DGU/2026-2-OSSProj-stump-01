# 공식 postgis/postgis 이미지는 amd64만 있어서 Apple Silicon(arm64)에서 느리다.
# 공식 postgres 이미지에 PostGIS 패키지를 설치해서 두 칩 모두 같은 이미지를 쓴다.
FROM postgres:17

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-postgis-3 \
    && rm -rf /var/lib/apt/lists/*
