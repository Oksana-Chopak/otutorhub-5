#!/usr/bin/env bash
# local-pg — одноразовий Postgres для db-replay у сесії агента (без Docker).
#
#   bash scripts/db-replay/local-pg.sh          # старт (або «вже працює»)
#   bash scripts/db-replay/local-pg.sh stop     # зупинити
#
# Після старту: PGHOST=/tmp PGPORT=5499 node scripts/gates.mjs
# (або node scripts/db-replay/replay.mjs напряму). Дані живуть у $PGDATA_DIR
# і не є частиною репозиторію; база прогону створюється й видаляється сама.
set -euo pipefail
PORT="${PGPORT:-5499}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$BIN" ]; then
  BIN="$(dirname "$(command -v pg_ctl 2>/dev/null || command -v postgres 2>/dev/null || true)")"
fi
if [ -z "$BIN" ] || [ ! -x "$BIN/pg_ctl" ]; then
  echo "Postgres не знайдено. Ubuntu/Debian: apt-get install -y postgresql-16 postgresql-client-16" >&2
  exit 1
fi
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  DATA="${PGDATA_DIR:-/var/lib/postgresql/otutorhub-replay}"
  RUN="su postgres -c"
else
  DATA="${PGDATA_DIR:-$HOME/.otutorhub-replay-pg}"
  RUN="bash -c"
fi

if [ "${1:-start}" = "stop" ]; then
  $RUN "$BIN/pg_ctl -D $DATA/data stop -m fast" || true
  exit 0
fi

mkdir -p "$DATA"
[ "$(id -u)" = "0" ] && chown -R postgres:postgres "$DATA" || true
if [ ! -f "$DATA/data/PG_VERSION" ]; then
  $RUN "$BIN/initdb -D $DATA/data -U postgres --auth=trust -E UTF8" >/dev/null
fi
if ! $RUN "$BIN/pg_ctl -D $DATA/data status" >/dev/null 2>&1; then
  $RUN "$BIN/pg_ctl -D $DATA/data -o '-p $PORT -k /tmp' -l $DATA/pg.log start" >/dev/null
  sleep 1
fi
psql -X -At -h /tmp -p "$PORT" -U postgres -d postgres -c "select 'Postgres ' || version()" | cut -c1-40
echo "готово → PGHOST=/tmp PGPORT=$PORT PGUSER=postgres node scripts/gates.mjs"
