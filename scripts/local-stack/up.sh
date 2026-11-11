#!/usr/bin/env bash
# local-stack/up — підняти «Supabase на одному порту» для живого проходу застосунку.
#
#   bash scripts/db-replay/local-pg.sh                 # Postgres (один раз на сесію)
#   bash scripts/local-stack/up.sh                     # база + PostgREST + шлюз + vite
#   node scripts/local-stack/school-walk.mjs           # прохід «перша школа» у браузері
#   bash scripts/local-stack/up.sh stop
#
# База stackdb збирається з УСІЄЇ історії міграцій (db-replay --keep), тож RLS, тригери й
# RPC — ті самі, що поїдуть у прод. PostgREST — той самий двійник, що в Supabase
# (бінарник береться з релізів GitHub у ~/.cache/otutorhub-stack). Edge-функцій тут немає:
# шлюз відповідає на них 501, і прохід це враховує.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-5499}" PGUSER="${PGUSER:-postgres}"
CACHE="${STACK_CACHE:-$HOME/.cache/otutorhub-stack}"; mkdir -p "$CACHE"
SECRET="local-stack-secret-local-stack-secret-32+"

if [ "${1:-up}" = "stop" ]; then
  pkill -f "$CACHE/postgrest" 2>/dev/null || true
  pkill -f "local-stack/gateway.mjs" 2>/dev/null || true
  pkill -f "vite --port 5173" 2>/dev/null || true
  exit 0
fi

if [ ! -x "$CACHE/postgrest" ]; then
  curl -sSL -o "$CACHE/pgrst.tar.xz" https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  tar -xf "$CACHE/pgrst.tar.xz" -C "$CACHE"
fi

bash "$0" stop
dropdb --if-exists stackdb
( cd "$ROOT" && REPLAY_DB=stackdb node scripts/db-replay/replay.mjs --keep | tail -1 )

cat > "$CACHE/pgrst.conf" <<CONF
db-uri = "postgres://$PGUSER@/stackdb?host=$PGHOST&port=$PGPORT"
db-schemas = "public"
db-extra-search-path = "public, extensions"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 54322
server-host = "127.0.0.1"
CONF
nohup "$CACHE/postgrest" "$CACHE/pgrst.conf" > "$CACHE/pgrst.log" 2>&1 < /dev/null &
( cd "$ROOT" && JWT_SECRET="$SECRET" nohup node scripts/local-stack/gateway.mjs > "$CACHE/gateway.log" 2>&1 < /dev/null & )
KEY="$(cd "$ROOT" && JWT_SECRET="$SECRET" node scripts/local-stack/gateway.mjs --anon-key)"
( cd "$ROOT" && VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_PUBLISHABLE_KEY="$KEY" nohup npx vite --port 5173 --host 127.0.0.1 > "$CACHE/vite.log" 2>&1 < /dev/null & )
for i in $(seq 1 40); do
  curl -s -o /dev/null http://127.0.0.1:5173/ && curl -s -o /dev/null http://127.0.0.1:54322/ && break; sleep 1
done
echo "[local-stack] готово: застосунок http://127.0.0.1:5173 · шлюз :54321 · журнали в $CACHE"
