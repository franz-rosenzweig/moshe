// Stands in for engine/src/import/index.js in a build made without it (vite.config.js, MOSHE_IMPORT_STUB).
export async function importFile(name) { throw new Error(`importing ${name} is not built into this version`); }
