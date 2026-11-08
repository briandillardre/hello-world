/**
 * Every row of a query, page by page. Supabase's API "Max Rows" setting
 * silently cuts one big `.limit(20000)` down to its cap (about 1,000 rows on
 * this project — observed Aug 12, the /api/history fix), so a read that must
 * be complete asks again from where the last answer stopped until an answer
 * comes back empty. Advancing by what actually came back (not by the page
 * asked for) is right whatever the cap is.
 *
 * `make(from, to)` must build the SAME query each time, ordered by a unique
 * column (`.order('id')`) and ending in `.range(from, to)`.
 */
export async function allRows<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts: { page?: number; max?: number } = {},
): Promise<{ rows: T[]; error: unknown | null; truncated: boolean }> {
  const page = opts.page ?? 1000
  const max = opts.max ?? 50_000
  const rows: T[] = []
  while (rows.length < max) {
    const from = rows.length
    const { data, error } = await make(from, Math.min(from + page, max) - 1)
    if (error) return { rows, error, truncated: true }
    if (!data?.length) return { rows, error: null, truncated: false }
    rows.push(...data)
  }
  return { rows, error: null, truncated: true }
}
