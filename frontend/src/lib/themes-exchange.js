// Extra editor themes, kept outside the repository: every module in
// ./private-themes/ (a folder git ignores, and absent from a fresh checkout)
// exports EXCHANGE, a list of theme cards. With no such folder the list is
// empty and Moshe has only its own themes. themes.js makes the editor's
// colours from a card, and a dark version for a light one.
// A card's keys: name, bg, text, heading, headingBg, tagH (the heading's #),
// tag, em, strong, mark/link/code + Bg, Border, Text.
const modules = import.meta.glob('./private-themes/*.js', { eager: true });
export const EXCHANGE = Object.keys(modules).sort().flatMap((k) => modules[k].EXCHANGE || []);
