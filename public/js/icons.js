// 知错 · 线性图标库（内联 SVG，不依赖外部资源）
const PATHS = {
  dashboard:
    '<rect x="3" y="3" width="7" height="9" rx="1.2"/><rect x="14" y="3" width="7" height="5" rx="1.2"/><rect x="14" y="12" width="7" height="9" rx="1.2"/><rect x="3" y="16" width="7" height="5" rx="1.2"/>',
  book:
    '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.8A2.8 2.8 0 0 0 4 21.3V5.5Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/><path d="M8 7h8M8 10.5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  practice:
    '<path d="M4 11a8 8 0 1 1 2.34 5.66"/><path d="M4 5v6h6"/><path d="M9.5 11.2l1.7 1.8 3.4-3.6"/>',
  paper:
    '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 11h6M9 14.5h6M9 18h3.5"/>',
  mastery:
    '<path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/><path d="M2.5 21h20"/>',
  settings:
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.65 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.65h.09A1.7 1.7 0 0 0 10.12 3.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.65a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.35 9v.09A1.7 1.7 0 0 0 20.9 10.12H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  camera:
    '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.6"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m21 16-5-5L6 20"/>',
  spark:
    '<path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8Z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 14h9l1-14"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  print:
    '<path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>',
  'arrow-right': '<path d="M4 12h15M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M20 12H5M11 18l-6-6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.5 2"/>',
  flame: '<path d="M12 22c4 0 6.5-2.6 6.5-6.2 0-4.6-4.3-6.3-4.3-10.3 0-1.2-.4-2.3-1.2-3.5 0 3-2 4.7-3.4 6.2A7.6 7.6 0 0 0 5.5 15C5.5 19 8 22 12 22Z"/><path d="M12 22c-1.9 0-3.2-1.3-3.2-3.1 0-2 2-3.1 2-5.4 1.7 1 2.9 3 2.9 5.1 0 1.9-1 3.4-1.7 3.4Z"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  refresh:
    '<path d="M20 11a8 8 0 1 0-.8 5"/><path d="M20 4v7h-7"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>',
  eye: '<path d="M2.5 12S5.8 5.5 12 5.5 21.5 12 21.5 12 18.2 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  alert: '<path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v5M12 17.2v.2"/>',
  'circle-check': '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7 5.3-5.6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  pen: '<path d="m4 20 4.5-1L20 7.5 16.5 4 5 15.5Z"/><path d="M4 20h5"/>',
  bookOpen:
    '<path d="M12 6.5C10 4.8 7 4.3 3.5 4.5v14c3.5-.2 6.5.3 8.5 2 2-1.7 5-2.2 8.5-2v-14C17 4.3 14 4.8 12 6.5Z"/><path d="M12 6.5v14"/>',
  brain:
    '<path d="M9.5 4.5A3 3 0 0 0 6.7 8a3.4 3.4 0 0 0-1.2 5.6A3.2 3.2 0 0 0 8 19.4 3 3 0 0 0 12 21V4.5a2.6 2.6 0 0 0-2.5 0Z"/><path d="M14.5 4.5A3 3 0 0 1 17.3 8a3.4 3.4 0 0 1 1.2 5.6 3.2 3.2 0 0 1-2.5 5.8 3 3 0 0 1-4 1.6V4.5a2.6 2.6 0 0 1 2.5 0Z"/>',
};
export function icon(name, size = 18) {
  const p = PATHS[name] || PATHS['circle-check'];
  return `<svg class="ico ico-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
export const ICON_NAMES = Object.keys(PATHS);
