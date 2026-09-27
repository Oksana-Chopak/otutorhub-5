/**
 * Довгі `.in(…)` — шматками.
 *
 * PostgREST приймає фільтр у РЯДКУ ЗАПИТУ: `?id=in.(uuid,uuid,…)`. Один UUID у
 * закодованому вигляді — близько 40 символів, тож уже двісті-триста
 * ідентифікаторів впираються в межу довжини адреси (проксі й браузери ріжуть
 * на 8–16 КБ). Наслідок найгіршого сорту: запит не «падає гучно», а віддає
 * 414 або помилку, яку виклик часто ігнорує, — і з екрана тихо зникає частина
 * даних (вкладення в довгому треді, реакції, профілі).
 *
 * Тому будь-яке читання, де кількість ідентифікаторів не обмежена дизайном
 * (повідомлення, уроки за рік, учні великої школи), проходить через цей
 * хелпер. Він повертає рядки всіх шматків і ПЕРШУ помилку — щоб виклик міг
 * сказати правду, а не показати половину списку як цілий.
 *
 * Це клієнтський двійник `_shared/fetchAll.ts` (той розвʼязує іншу межу —
 * max_rows у відповіді).
 */
export const IN_CHUNK = 100;

export async function selectInChunks<T, E = unknown>(
  ids: readonly string[],
  page: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: E | null }>,
  size: number = IN_CHUNK,
): Promise<{ data: T[]; error: E | null; chunks: number }> {
  /* Порожній список НЕ потребує окремої гілки: цикл нижче просто не виконається
     жодного разу. Спеціальний `return` тут був би мертвим кодом — поведінку
     («жодного запиту на порожньому списку») тримає тест, а не зайва умова. */
  const out: T[] = [];
  let firstError: E | null = null;
  let chunks = 0;
  for (let i = 0; i < ids.length; i += size) {
    chunks += 1;
    const { data, error } = await page(ids.slice(i, i + size));
    if (error && !firstError) firstError = error;
    if (data) out.push(...data);
  }
  return { data: out, error: firstError, chunks };
}
