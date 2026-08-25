// 🌱 Сідер демо-даних рецензента. Канонічні виклики застосунку:
// rpc add_or_link_independent_student; lessons payload як у QuickLessonDialog;
// completed/paid — ті самі поля, що пише UI. Ідемпотентний.
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPA_URL, process.env.SUPA_ANON);
const { data: auth, error: e0 } = await sb.auth.signInWithPassword({
  email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });
if (e0) { console.error("AUTH ERR", e0.message); process.exit(1); }
const uid = auth.user.id;
const STUDENTS = [["Демо","Учень Один","Англійська",600],["Демо","Учень Два","Математика",550],["Демо","Учень Три","Фізика",500]];
const rows = [];
const at = (offD, h) => { const d = new Date(Date.now() + offD*86400000); d.setUTCHours(h,0,0,0); return d.toISOString(); };
for (const [fn, ln, subj, price] of STUDENTS) {
  let sid;
  const { data: ex } = await sb.from("student_rates")
    .select("student_id, profiles:student_id(first_name,last_name)")
    .eq("tutor_id", uid).eq("subject", subj);
  sid = (ex ?? []).find(r => r.profiles?.first_name===fn && r.profiles?.last_name===ln)?.student_id;
  if (!sid) {
    const { data: res, error } = await sb.rpc("add_or_link_independent_student", {
      _first_name: fn, _last_name: ln, _email: "", _phone: "", _telegram: "",
      _subject: subj, _price: price, _currency: "UAH" });
    if (error) { rows.push(["учень "+ln,"ERR",error.message]); continue; }
    sid = typeof res === "string" ? res : (res && (res.student_id ?? res.id));
    rows.push(["учень "+ln,"створено",String(sid).slice(0,8)]);
  } else rows.push(["учень "+ln,"вже є",String(sid).slice(0,8)]);
  const { count } = await sb.from("lessons").select("id",{count:"exact",head:true})
    .eq("tutor_id",uid).eq("student_id",sid);
  if ((count ?? 0) >= 3) { rows.push(["уроки "+ln,"вже є",count]); continue; }
  const mk = (o,h) => ({ tutor_id: uid, student_id: sid, subject: subj,
    duration_minutes: 60, status: "scheduled", created_by: uid,
    source: "independent", meeting_url: null, starts_at: at(o,h) });
  const { data: ins, error: e1 } = await sb.from("lessons")
    .insert([mk(-7,10), mk(-3,12), mk(5,16)]).select("id, starts_at");
  if (e1) { rows.push(["уроки "+ln,"ERR",e1.message]); continue; }
  rows.push(["уроки "+ln,"3 створено","-7д/-3д/+5д"]);
  const past = ins.filter(l => new Date(l.starts_at) < new Date()).map(l => l.id);
  if (past.length) {
    const { error: e2 } = await sb.from("lessons").update({ status: "completed" }).in("id", past);
    rows.push(["проведені "+ln, e2 ? "ERR" : "ok", e2 ? e2.message : String(past.length)]);
  }
  if (past[0]) {
    const { error: e3 } = await sb.from("lesson_details")
      .update({ student_payment_status: "paid", student_paid_at: new Date().toISOString() })
      .eq("lesson_id", past[0]);
    rows.push(["оплата "+ln, e3 ? "ERR" : "ok", e3 ? e3.message : "1 урок paid"]);
  }
}
for (const r of rows) console.log(r.join(" | "));
if (rows.some(r => r[1] === "ERR")) process.exit(1);
console.log("SEED OK");
