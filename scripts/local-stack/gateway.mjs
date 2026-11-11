#!/usr/bin/env node
/**
 * local-stack/gateway — «Supabase на одному порту» для живого проходу застосунку
 * проти СПРАВЖНЬОЇ бази з усією історією міграцій (RLS, тригери, RPC — справжні).
 *
 * Навіщо (11.11): стенд `demo/fake` — фальшивий клієнт без бази, робот на проді лише
 * читає. Шлях «власниця школи додала репетитора, учня, групу, урок» не міг пройти
 * ніхто, крім власниці на живих людях. Тут його проходить Playwright: справжній
 * фронтенд (vite) → цей шлюз → PostgREST → локальний Postgres зі зібраною схемою.
 *
 *   /rest/v1/*       → PostgREST (той самий, що в Supabase)
 *   /auth/v1/*       → мінімальний двійник GoTrue: signup / пароль / refresh / user /
 *                      logout. Реєстрація пише рядок в auth.users — тригери проєкту
 *                      (handle_new_user, злиття запрошеного профілю) працюють як у проді.
 *   /functions/v1/*  → 501 з назвою функції (edge тут не запускаються; виклики
 *                      збираються у /__calls, щоб прохід бачив, що саме кликали)
 *   /storage, /realtime → 404 (застосунок має це пережити)
 *
 * Пароль не перевіряється: це стенд, а не безпека. JWT — HS256 тим самим секретом,
 * що й у PostgREST.
 */
import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const PGRST = process.env.PGRST_URL ?? "http://127.0.0.1:54322";
const SECRET = process.env.JWT_SECRET ?? "local-stack-secret-local-stack-secret-32+";
const DB = process.env.STACK_DB ?? "stackdb";
const PG = { PGHOST: process.env.PGHOST ?? "/tmp", PGPORT: process.env.PGPORT ?? "5499", PGUSER: process.env.PGUSER ?? "postgres" };

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export function sign(payload) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  try {
    const [h, b, s] = String(token ?? "").split(".");
    if (createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url") !== s) return null;
    return JSON.parse(Buffer.from(b, "base64url").toString("utf8"));
  } catch { return null; }
}
export const anonKey = () => sign({ role: "anon", iss: "local-stack", exp: 4102444800 });

function sql(query, params = []) {
  // psql із параметрами через -v і :'name' — без конкатенації значень у запит
  const args = ["-X", "-q", "-At", "-d", DB];
  params.forEach((p, i) => args.push("-v", `p${i + 1}=${p ?? ""}`));
  const r = spawnSync("psql", args, { input: query, encoding: "utf8", env: { ...process.env, ...PG } });
  if (r.status !== 0) throw new Error((r.stderr || "psql failed").trim());
  return r.stdout.trim();
}

function userRow(where, param) {
  const out = sql(
    `SELECT json_build_object('id', id, 'email', email, 'user_metadata', coalesce(raw_user_meta_data, '{}'::jsonb),
            'email_confirmed_at', email_confirmed_at, 'created_at', created_at)::text
       FROM auth.users WHERE ${where} LIMIT 1;`, [param]);
  return out ? JSON.parse(out) : null;
}
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    email_confirmed_at: u.email_confirmed_at, confirmed_at: u.email_confirmed_at,
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.user_metadata ?? {},
    identities: [], created_at: u.created_at, updated_at: u.created_at,
  };
  const access_token = sign({
    sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, iss: "local-stack",
    iat: now, exp: now + 3600 * 12, user_metadata: user.user_metadata, app_metadata: user.app_metadata,
  });
  return { access_token, token_type: "bearer", expires_in: 3600 * 12, expires_at: now + 3600 * 12, refresh_token: `rt-${u.id}`, user };
}

const calls = [];
const cors = (req) => ({
  "access-control-allow-origin": req.headers.origin ?? "*",
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
  "access-control-expose-headers": "content-range, content-profile, x-total-count",
  "access-control-max-age": "86400",
});
const send = (req, res, status, body, extra = {}) => {
  const data = body == null ? "" : JSON.stringify(body);
  res.writeHead(status, { ...cors(req), "content-type": "application/json", ...extra });
  res.end(data);
};
const readBody = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "OPTIONS") { res.writeHead(204, cors(req)); return res.end(); }
  try {
    // ── REST → PostgREST ──────────────────────────────────────────────────────
    if (url.pathname.startsWith("/rest/v1")) {
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
      const headers = { ...req.headers };
      delete headers.host; delete headers["content-length"]; delete headers.connection; delete headers.apikey;
      const up = await fetch(PGRST + url.pathname.replace(/^\/rest\/v1/, "") + url.search, { method: req.method, headers, body });
      const buf = Buffer.from(await up.arrayBuffer());
      const out = { ...cors(req) };
      for (const [k, v] of up.headers) if (!["transfer-encoding", "content-encoding", "content-length", "connection"].includes(k) && !k.startsWith("access-control")) out[k] = v;
      res.writeHead(up.status, out);
      return res.end(buf);
    }
    // ── AUTH ──────────────────────────────────────────────────────────────────
    if (url.pathname.startsWith("/auth/v1")) {
      const path = url.pathname.replace(/^\/auth\/v1/, "");
      const raw = ["GET", "HEAD"].includes(req.method) ? null : (await readBody(req)).toString("utf8");
      const body = raw ? JSON.parse(raw || "{}") : {};
      const bearer = verify(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
      if (path === "/signup" && req.method === "POST") {
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!email) return send(req, res, 422, { msg: "email required" });
        if (userRow("lower(email) = lower(:'p1')", email)) return send(req, res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
        const id = randomUUID();
        sql(`INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES (:'p1', :'p2', now(), :'p3'::jsonb);`,
          [id, email, JSON.stringify(body.data ?? {})]);
        return send(req, res, 200, session(userRow("id = :'p1'::uuid", id)));
      }
      if (path === "/token" && req.method === "POST") {
        const grant = url.searchParams.get("grant_type");
        let u = null;
        if (grant === "password") u = userRow("lower(email) = lower(:'p1')", String(body.email ?? ""));
        else if (grant === "refresh_token") u = userRow("id = :'p1'::uuid", String(body.refresh_token ?? "").replace(/^rt-/, ""));
        if (!u) return send(req, res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
        return send(req, res, 200, session(u));
      }
      if (path === "/user") {
        if (!bearer?.sub) return send(req, res, 401, { msg: "invalid JWT" });
        if (req.method === "PUT" && body.data) {
          sql(`UPDATE auth.users SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || :'p2'::jsonb WHERE id = :'p1'::uuid;`, [bearer.sub, JSON.stringify(body.data)]);
        }
        const u = userRow("id = :'p1'::uuid", bearer.sub);
        return u ? send(req, res, 200, session(u).user) : send(req, res, 404, { msg: "user not found" });
      }
      if (path === "/logout") { res.writeHead(204, cors(req)); return res.end(); }
      return send(req, res, 404, { msg: `auth: ${path} не емулюється` });
    }
    // ── edge / решта ──────────────────────────────────────────────────────────
    if (url.pathname === "/__calls") return send(req, res, 200, calls);
    if (url.pathname.startsWith("/functions/v1/")) {
      const fn = url.pathname.split("/")[3];
      calls.push({ fn, at: new Date().toISOString() });
      return send(req, res, 501, { error: `edge-функція ${fn} на локальному стенді не запускається` });
    }
    return send(req, res, 404, { error: "not emulated", path: url.pathname });
  } catch (e) {
    return send(req, res, 500, { error: String(e?.message ?? e) });
  }
});

if (process.argv[1] && process.argv[1].endsWith("gateway.mjs")) {
  if (process.argv.includes("--anon-key")) { console.log(anonKey()); process.exit(0); }
  server.on("upgrade", (_req, socket) => socket.destroy()); // realtime тут немає
  server.listen(PORT, () => console.log(`[local-stack] шлюз на :${PORT} → PostgREST ${PGRST} · база ${DB}`));
}
