/**
 * Наповнення рецензентського акаунта демо-даними — обхід мертвого браузер-
 * розширення. Запуск НА ТВОЄМУ MAC (ключі не покидають машину):
 *
 *   SUPABASE_URL="https://<project>.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="<service_role з Lovable → Settings → API>" \
 *   node scripts/seed-review-account.mjs
 *
 * Ідемпотентно: повторний запуск нічого не дублює.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REVIEW_EMAIL = process.env.REVIEW_EMAIL || "oksana.chopak+review@gmail.com";
if (!URL || !KEY) { console.error("✗ Постав SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const STUDENTS = [
  { email: "review-demo-s1@otutorhub.com", name: "Марія Коваль",   subject: "Англійська", price: 500 },
  { email: "review-demo-s2@otutorhub.com", name: "Олег Ткаченко",  subject: "Математика", price: 450 },
  { email: "review-demo-s3@otutorhub.com", name: "Софія Юрченко",  subject: "Польська",   price: 600 },
];
const SUMMARIES = [
  "Тема: минулі часи. Розібрали Past Simple vs Past Continuous, 12 речень усно.\n• Добре йде впізнавання маркерів часу\n• Домашка: вправа 4.2, 10 речень",
  "Тема: квадратні рівняння. Дискримінант, 8 задач біля дошки.\n• Впевнено рахує D, плутає знак у формулі коренів\n• Наступного разу — теорема Вієта",
];

async function findUser(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function ensureStudent(s) {
  let u = await findUser(s.email);
  if (!u) {
    const { data, error } = await db.auth.admin.createUser({
      email: s.email, password: "DemoStud2026!", email_confirm: true,
      user_metadata: { full_name: s.name },
    });
    if (error) throw error;
    u = data.user;
    console.log("  + учень створений:", s.name);
  } else console.log("  = учень існує:", s.name);
  const [fn, ...ln] = s.name.split(" ");
  await db.from("profiles").upsert({ id: u.id, first_name: fn, last_name: ln.join(" ") }, { onConflict: "id" });
  return u.id;
}

const at = (daysFromNow, hour) => {
  const d = new Date(); d.setDate(d.getDate() + daysFromNow); d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function main() {
  const tutor = await findUser(REVIEW_EMAIL);
  if (!tutor) { console.error("✗ Рецензентський акаунт не знайдено:", REVIEW_EMAIL); process.exit(1); }
  console.log("Тьютор:", REVIEW_EMAIL, tutor.id);
  await db.from("tutor_workspace_settings").upsert(
    { tutor_id: tutor.id, onboarding_completed: true, daily_digest_enabled: true },
    { onConflict: "tutor_id" });

  for (const s of STUDENTS) {
    const sid = await ensureStudent(s);
    await db.from("student_rates").upsert(
      { tutor_id: tutor.id, student_id: sid, source: "independent", subject: s.subject, price_per_lesson: s.price },
      { onConflict: "tutor_id,student_id" });
    await db.from("tutor_student_defaults").upsert(
      { tutor_id: tutor.id, student_id: sid, default_meeting_url: "https://meet.google.com/demo-otutorhub" },
      { onConflict: "tutor_id,student_id" });

    const { count } = await db.from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("tutor_id", tutor.id).eq("student_id", sid);
    if ((count ?? 0) >= 4) { console.log("  = уроки вже насіяні для", s.name); continue; }

    const rows = [
      { d: -14, status: "completed", paid: "paid",   summary: SUMMARIES[0], homework: "Вправа 4.2 — 10 речень письмово" },
      { d: -7,  status: "completed", paid: "unpaid", summary: SUMMARIES[1], homework: null },
      { d: +1,  status: "scheduled", paid: "unpaid", summary: null, homework: null },
      { d: +3,  status: "scheduled", paid: "unpaid", summary: null, homework: null },
    ];
    for (const r of rows) {
      const { data: ins, error } = await db.from("lessons").insert({
        tutor_id: tutor.id, created_by: tutor.id, student_id: sid,
        subject: s.subject, duration_minutes: 60, status: r.status,
        source: "independent", starts_at: at(r.d, 18), meeting_url: null,
      }).select("id").single();
      if (error) throw error;
      if (r.summary || r.homework) {
        await db.from("lesson_details").upsert(
          { lesson_id: ins.id, summary: r.summary, homework: r.homework, student_price: s.price, student_payment_status: r.paid },
          { onConflict: "lesson_id" });
      } else {
        await db.from("lesson_details").upsert(
          { lesson_id: ins.id, student_price: s.price, student_payment_status: r.paid }, { onConflict: "lesson_id" });
      }
    }
    console.log("  + 4 уроки (2 минулі з конспектами, 1 борг, 2 майбутні) —", s.name);
  }
  console.log("\n✓ Демо-дані готові. Логін рецензента:", REVIEW_EMAIL, "/ Review2026!");
}
main().catch((e) => { console.error("✗", e.message ?? e); process.exit(1); });
