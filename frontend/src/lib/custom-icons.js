// Icons of Moshe's own, where no Lucide icon is close: a group (a
// sheet with its corner folded, another behind it), All (a tray of drawers),
// the toolbar's sidebars (a panel with lines in it) and New Group (a folder
// with a plus badge).
// The inside of an <svg viewBox="0 0 24 24">, stroked in the current colour.
export const CUSTOM_ICONS = {
  sheets: '<path d="M5.5 7.5v11a2.5 2.5 0 0 0 2.5 2.5h8.5"/>'
    + '<path d="M10 3h5.5l4 4v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" fill-opacity="0.13"/>'
    + '<path d="M15.5 3v4h4"/><path d="M11 11.5h5.5M11 14.5h5.5"/>',
  drawers: '<rect x="4" y="3.5" width="16" height="17" rx="2.5" fill="currentColor" fill-opacity="0.13"/>'
    + '<path d="M4 12h16"/><path d="M9.5 7.5a2.5 1.5 0 0 0 5 0"/><path d="M9.5 16a2.5 1.5 0 0 0 5 0"/>',
  tray: '<path d="M3.5 13.5 6 7.5a2 2 0 0 1 1.8-1.2h1.7M14.5 6.3h1.7A2 2 0 0 1 18 7.5l2.5 6"/>'
    + '<path d="M3.5 13.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4.5h-5a3 3 0 0 1-6 0z" fill="currentColor" fill-opacity="0.13"/>'
    + '<path d="M12 3v7.5M9.5 8 12 10.5 14.5 8"/>',
  'sidebar-left': '<rect x="2.5" y="4.5" width="19" height="15" rx="3.5"/><path d="M9 4.5v15"/><path d="M4.9 8.5h1.8M4.9 11h1.8M4.9 13.5h1.8"/>',
  'sidebar-right': '<rect x="2.5" y="4.5" width="19" height="15" rx="3.5"/><path d="M15 4.5v15"/><path d="M17.3 8.5h1.8M17.3 11h1.8M17.3 13.5h1.8"/>',
  'folder-badge-plus': '<path d="M14 6.5H11L9.3 4.8a1.2 1.2 0 0 0-.9-.3H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/><path d="M3 9h8"/>'
    + '<path d="M8 14.3h.01M11 14.3h.01M14 14.3h.01" stroke-width="2.4"/>'
    + '<circle cx="18" cy="6" r="4.5" fill="currentColor" stroke="none"/><path d="M18 3.9v4.2M15.9 6h4.2" style="stroke: var(--button-bg, #fff)" stroke-width="1.6"/>',
};
