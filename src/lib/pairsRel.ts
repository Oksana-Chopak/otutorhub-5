import { supabase } from "@/integrations/supabase/client";

/**
 * Звідки ЧИТАТИ пари «учень — репетитор» (11.11, рішення власниці: репетитор школи
 * не бачить жодних грошей).
 *
 * У таблиці `student_rates` лежить ціна, яку учень платить ШКОЛІ. RLS не вміє
 * ховати окрему колонку, тож репетитор школи, читаючи свої пари (а вони йому
 * потрібні: кого ставити в урок, з ким чат), отримував і ціну. Вʼю
 * `student_pairs_visible` віддає ті самі рядки й колонки, але ціну й реквізити
 * репетиторові школи — NULL. Правило грошей живе в базі, не в клієнті.
 *
 * Код і база їдуть різними каналами (Publish окремо, SQL окремо), тому перший
 * запит перевіряє, чи вʼю вже є: немає — читаємо таблицю, як раніше. ЗАПИС завжди
 * йде в таблицю напряму (`.from("student_rates")`), сюди — лише читання.
 *
 * Тип повернення навмисно «student_rates»: колонки ті самі, і типізація запитів
 * лишається справжньою. `check-db-select.mjs` звіряє такі select із таблицею.
 */
const VIEW = "student_pairs_visible";
let probe: Promise<boolean> | null = null;

async function viewExists(): Promise<boolean> {
  try {
    const { error } = await (supabase as any).from(VIEW).select("id").limit(1);
    if (!error) return true;
    const code = String((error as any).code ?? "");
    const msg = String((error as any).message ?? "");
    // вʼю ще не створено: PostgREST не знає такого імені
    if (code === "PGRST205" || code === "42P01" || /schema cache|does not exist|not find/i.test(msg)) return false;
    // інший збій (мережа, сесія) — це не відповідь; спитаємо ще раз наступного разу
    probe = null;
    return false;
  } catch {
    probe = null;
    return false;
  }
}

export async function pairsRel(): Promise<"student_rates"> {
  if (!probe) probe = viewExists();
  return ((await probe) ? VIEW : "student_rates") as "student_rates";
}

/** Лише для тестів. */
export function __resetPairsRel() { probe = null; }
