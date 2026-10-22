// Stands in for engine/src/export/index.js in a build made without it (vite.config.js, MOSHE_EXPORT_STUB).
export const STYLES = { everyday: { name: 'Everyday' } };
export const STYLE_ORDER = ['everyday'];
export function exportSheets() { throw new Error('export is not built into this version'); }
