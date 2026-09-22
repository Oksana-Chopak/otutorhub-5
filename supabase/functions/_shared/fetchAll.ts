/**
 * 22.09 (аудит «весь застосунок»): PostgREST віддає не більше max_rows рядків
 * (у Supabase типово 1000) — БЕЗ помилки й без жодної ознаки обрізання.
 * Cron-функції, що читають «усі уроки платформи» одним запитом, тихо губили
 * все понад тисячу: борги, виплати, «ставку не задано» зникали з ранкового
 * дайджесту — а репетитор отримував «✅ Всі оплати закриті». Серії уроків на
 * пів року вперед роблять тисячу рядків питанням тижнів, а не років.
 *
 * Дочитуємо сторінками ДО ПОРОЖНЬОЇ і рухаємось на кількість реально
 * отриманих рядків — тож працює навіть коли на сервері ліміт менший за
 * pageSize. Запит мусить мати стабільний порядок (.order по id), інакше
 * сторінки можуть перекриватись.
 */
export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<{ data: T[]; error: { message: string } | null; capped: boolean }> {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 200_000;
  const out: T[] = [];
  for (;;) {
    const from = out.length;
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: out, error, capped: false };
    const rows = data ?? [];
    if (rows.length === 0) return { data: out, error: null, capped: false };
    out.push(...rows);
    if (out.length >= maxRows) return { data: out, error: null, capped: true };
  }
}
