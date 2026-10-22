// Menus, dialogs and popovers: one of each at a time, opened from anywhere.

export const ui = $state({
  menu: null,        // {x, y, items: [{label, key, icon, action, disabled, checked, sep, label-only}]}
  dialog: null,      // {kind, ...props}
  drag: null,        // {kind: 'sheets'|'group', paths, over, where}
});

/** A context menu at the pointer (or under an element). */
export function openMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  let x = e.clientX, y = e.clientY;
  if (!x && !y && e.currentTarget) {
    const r = e.currentTarget.getBoundingClientRect();
    x = r.left; y = r.bottom + 4;
  }
  ui.menu = { x, y, items: items.filter(Boolean) };
}

export function menuUnder(el, items, align = 'left') {
  const r = el.getBoundingClientRect();
  ui.menu = { x: align === 'right' ? r.right - 220 : r.left, y: r.bottom + 6, items: items.filter(Boolean) };
}

export const closeMenu = () => { ui.menu = null; };

/** A dialog; resolves with what it returns (null when cancelled). */
export function openDialog(kind, props = {}) {
  return new Promise((resolve) => {
    ui.dialog = { kind, ...props, resolve: (v) => { ui.dialog = null; resolve(v); } };
  });
}

export const confirm = (title, message, ok = 'OK', danger = false) => openDialog('confirm', { title, message, ok, danger });

// the colours a group, filter or project may have (twelve)
export const COLORS = {
  black: '#272727', red: '#ff383c', orange: '#ff8d27', yellow: '#ffcc00', green: '#36c759', teal: '#06c3d0',
  blue: '#0088ff', indigo: '#6155f5', purple: '#ca31e0', pink: '#ff2d55', brown: '#ac7f5e', gray: '#8e8e93',
};
export const COLOR_ORDER = Object.keys(COLORS);
export const colorOf = (name, fallback = null) => (name && COLORS[name]) || name || fallback;
