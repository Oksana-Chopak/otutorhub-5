/**
 * ЧИТАННЯ СТОРІНКАМИ (17.11, обʼємна перевірка «школа на 150 учнів»).
 *
 * API віддає не більше 1000 рядків за запит і НЕ каже, що обрізав: `.limit(2000)` мовчки
 * повертає 1000. Поки в застосунку працювала одна репетиторка, жоден екран до цієї межі не
 * доходив. Школа на 150 учнів має 180 уроків на тиждень — і «Мій день» показував «0 уроків
 * сьогодні», «Розклад» починався з уроків через два тижні, а «Фінанси» писали «Учні винні 0»
 * при 270 950 боргу в базі.
 *
 * `readAllPages` дочитує запит сторінками до стелі `cap` і ЧЕСНО повертає `truncated`, якщо
 * рядків більше: екран мусить це сказати словами, а не показати неповне як повне.
 * Запит зобовʼязаний мати стабільний порядок (другим ключем — `id`), інакше сторінки
 * перекриваються або губляться рядки на межі.
 */
export const API_PAGE = 1000;

type PageResult<T> = { data: T[] | null; error: unknown };

export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { cap?: number; pageSize?: number } = {},
): Promise<{ data: T[]; error: unknown; truncated: boolean }> {
  const pageSize = Math.min(opts.pageSize ?? API_PAGE, API_PAGE);
  const cap = opts.cap ?? 5000;
  const out: T[] = [];
  for (let from = 0; from < cap; from += pageSize) {
    const to = Math.min(from + pageSize, cap) - 1;
    const { data, error } = await page(from, to);
    if (error) return { data: out, error, truncated: false };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < to - from + 1) return { data: out, error: null, truncated: false };
  }
  // дійшли до стелі повними сторінками — далі, найімовірніше, є ще
  return { data: out, error: null, truncated: true };
}
