const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  wrench: '<path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 12l-2-2 2.7-2.7Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  play: '<path d="M8 5.5v13l10-6.5Z"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
  logIn: '<path d="M15 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  logOut: '<path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/><path d="m14 8 4 4-4 4M18 12H8"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6Z"/><path d="m9.5 12 2 2 3.5-4"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  loader: '<path d="M12 3a9 9 0 1 0 9 9"/>',
};

export function icon(name) {
  const body = ICONS[name] || ICONS.wrench;
  const spin = name === 'loader' ? ' class="spin"' : '';
  return `<svg${spin} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function toast(message, type = 'success') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'toast-error' : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

export function openSheet({ title, content }) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = `
    <div class="sheet-overlay" id="sheet-overlay">
      <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="sheet-head">
          <h2 class="sheet-title">${escapeHtml(title)}</h2>
          <button type="button" class="icon-btn sheet-close" aria-label="关闭">${icon('x')}</button>
        </div>
        ${content}
      </div>
    </div>`;
  const overlay = document.getElementById('sheet-overlay');
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    root.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.sheet-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  return { close };
}

export function statusMeta(status) {
  const map = {
    idle: { label: '空闲', dot: 'status-idle', badge: 'badge-idle' },
    in_use: { label: '使用中', dot: 'status-in_use', badge: 'badge-in_use' },
    reserved: { label: '已预约', dot: 'status-reserved', badge: 'badge-reserved' },
  };
  return map[status] || map.idle;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function toLocalInputValue(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localValueToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatDateTime(iso, { includeYear = false } = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = includeYear
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
