// Поиск, фильтры и сортировка списка рецептов — одна реализация для ПК и телефона.
// На вход — краткие карточки рецептов (их отдают оба хранилища), на выход — отобранные и упорядоченные.

const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е');
const SITE_PREFIX = /^(YouTube|Instagram|TikTok|VK Видео|Rutube|Дзен|Текст вручную),?\s*/;

// Автор для фильтра: канал или автор рецепта; если не указан — сайт-источник.
export function authorOf(r) {
  const a = (r.author || '').trim();
  if (a) return a;
  const src = (r.source_name || '').replace(SITE_PREFIX, '').trim();
  return src || null;
}

export function inCollection(r, collection) {
  if (collection === 'channels') return !!r.channel_id;
  if (collection === 'all') return true;
  return !r.channel_id || !!r.saved;
}

function searchText(r) {
  if (!r._search) {
    r._search = norm([r.title, r.description, r.author, r.source_name, ...(r.ingredients || []).map((i) => i.name),
      ...(r.tags || []), ...(r.categories || [])].join(' '));
  }
  return r._search;
}

export function filterItems(items, { q = '', category = '', favorite = false, review = false, author = '' } = {}) {
  const words = norm(q).match(/[\p{L}\p{N}]+/gu) || [];
  return items.filter((r) => (!words.length || words.every((w) => searchText(r).includes(w)))
    && (!category || (r.categories || []).includes(category))
    && (!favorite || r.favorite)
    && (!review || r.needs_review)
    && (!author || authorOf(r) === author));
}

const totalTime = (r) => r.total_time_min || null;
const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', 'ru');
const nullsLast = (x, y) => (x == null) - (y == null);

export const SORTS = {
  new: { label: 'Сначала новые', cmp: (a, b) => (b.created_at || '').localeCompare(a.created_at || '') },
  popular: { label: 'Популярные', cmp: (a, b) => (b.video_views || 0) - (a.video_views || 0) || byTitle(a, b) },
  fresh: { label: 'Новые видео', cmp: (a, b) => (b.video_date || '').localeCompare(a.video_date || '') || byTitle(a, b) },
  quick: { label: 'Быстрые', cmp: (a, b) => nullsLast(totalTime(a), totalTime(b)) || (totalTime(a) || 0) - (totalTime(b) || 0) || byTitle(a, b) },
  simple: { label: 'Меньше ингредиентов', cmp: (a, b) => nullsLast(a.ingredients_count || null, b.ingredients_count || null) || (a.ingredients_count || 0) - (b.ingredients_count || 0) || byTitle(a, b) },
  title: { label: 'По названию', cmp: byTitle },
};
export const SORTS_FOR = { mine: ['new', 'title', 'quick', 'simple'], channels: ['popular', 'fresh', 'quick', 'simple', 'title'] };

export function sortItems(items, sort) {
  const s = SORTS[sort] || SORTS.new;
  return [...items].sort(s.cmp);
}

// Число рецептов по категориям и авторам — для чипов и списка авторов.
export function facets(items) {
  const categories = {};
  const authors = {};
  for (const r of items) {
    for (const c of r.categories || []) categories[c] = (categories[c] || 0) + 1;
    const a = authorOf(r);
    if (a) authors[a] = (authors[a] || 0) + 1;
  }
  return { categories, authors: Object.entries(authors).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'ru')) };
}
