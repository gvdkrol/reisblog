const dateFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'long' });
const dayMonth = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
const numFmt = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });

export function formatDate(iso) {
  return iso ? dateFmt.format(new Date(iso)) : '';
}

export function formatRange(from, to) {
  if (!from) return '';
  const a = new Date(from);
  const b = new Date(to || from);
  if (from === to || !to) return dayMonthYear.format(a);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${dayMonthYear.format(b)}`;
  }
  return `${dayMonth.format(a)} – ${dayMonthYear.format(b)}`;
}

export function formatKm(km) {
  return `${numFmt.format(km)} km`;
}

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h}u ${String(m).padStart(2, '0')}m` : `${h}u`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
