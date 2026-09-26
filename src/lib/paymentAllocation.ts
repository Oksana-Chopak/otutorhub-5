/**
 * «Прийшло 1500 — що це закриває?» (важіль 5 аудиту шляхів 24.09).
 *
 * Людина думає СУМОЮ: «Оля переказала 1500 за три уроки». Продукт досі змушував
 * думати структурою бази: знайти пару, знайти три уроки, натиснути на кожному
 * «Позначити». Тепер сума вводиться першою, а застосунок показує, що саме вона
 * закриває — і запис іде канонічним шляхом: поповнення гаманця пари, після
 * якого борги закриває сама база (`wallet_settle_pair`).
 *
 * ЦЯ функція — рівно ДЗЕРКАЛО того SQL, щоб показане збігалося з тим, що
 * станеться. Правила звідти, дослівно:
 *   · беруться неоплачені уроки пари з ціною > 0, НЕ скасовані;
 *   · порядок — за датою початку, від найстарішого;
 *   · урок закривається лише ПОВНІСТЮ: якщо решти не хватає — цикл
 *     ЗУПИНЯЄТЬСЯ (у SQL це `ELSE EXIT`), а не перескакує на дешевший урок;
 *   · те, що лишилось, лежить на гаманці пари й закриє наступні уроки.
 *
 * Якщо колись зміниться SQL — мусить змінитись і це; тест
 * `payment-allocation.test.ts` тримає обидва боки разом.
 */

export type AllocLesson = {
  id: string;
  starts_at: string;
  student_price: number | string | null;
  status?: string | null;
};

export type Allocation = {
  /** Уроки, які ця сума закриває повністю, від найстарішого. */
  covered: AllocLesson[];
  /** Скільки лишиться на гаманці пари після закриття. */
  leftover: number;
  /** Сума закритих уроків. */
  used: number;
};

export function allocateAmount(amount: number, lessons: AllocLesson[]): Allocation {
  const money = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const queue = lessons
    .filter((l) => (l.status ?? "") !== "cancelled" && Number(l.student_price ?? 0) > 0)
    .slice()
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));

  const covered: AllocLesson[] = [];
  let left = money;
  for (const l of queue) {
    const price = Number(l.student_price ?? 0);
    if (left + 1e-9 < price) break; // ELSE EXIT: частково урок не закривається
    left -= price;
    covered.push(l);
  }
  return { covered, leftover: Math.round(left * 100) / 100, used: Math.round((money - left) * 100) / 100 };
}
