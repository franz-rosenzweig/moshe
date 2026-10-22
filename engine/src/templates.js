// Project templates: what a new project starts with (the templates of
// "Add Project…"). Each is groups and sheets, the main content first and the
// Extras after; every project also gets Extras/Templates.

const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

/** @type {Record<string, {name: string, icon: string, description: string, groups: object[], extras: object[]}>} */
export const PROJECT_TEMPLATES = {
  empty: {
    name: 'Empty Project', icon: 'folder', description: 'Nothing but a first group.',
    groups: [{ name: 'Drafts', sheets: [] }],
    extras: [{ name: 'Notes', sheets: [] }, { name: 'Research', sheets: [] }],
  },
  novel: {
    name: 'Novel', icon: 'book', description: 'Front and back matter, five chapters, and places for characters and plot.',
    groups: [
      { name: 'Front Matter', sheets: ['# {title}\n_by {author}_\n', '## Dedication page\n', '## Epigraph\n', `## Preface\n${lorem}\n`, `## Foreword\n${lorem}\n`] },
      { name: 'Prologue', sheets: [`## Prologue\n${lorem}\n`] },
      { name: 'Chapters', sheets: [], groups: ['One', 'Two', 'Three', 'Four', 'Five'].map((n, i) => ({ name: n, sheets: [`## Chapter ${i + 1}\n${lorem}\n`] })) },
      { name: 'Epilogue', sheets: [`## Epilogue\n${lorem}\n`] },
      { name: 'Back Matter', sheets: ['## Acknowledgements\n', '## About the Author\n'] },
    ],
    extras: ['Notes', 'Characters', 'Locations', 'Plot', 'Research', 'Other'].map((name) => ({ name, sheets: [] })),
  },
  nonfiction: {
    name: 'Non-Fiction Book', icon: 'book-closed', description: 'Parts and chapters, with room for sources.',
    groups: [
      { name: 'Front Matter', sheets: ['# {title}\n_by {author}_\n', '## Contents\n(toc)\n', '## Introduction\n'] },
      { name: 'Part One', sheets: ['## Chapter 1\n', '## Chapter 2\n'] },
      { name: 'Part Two', sheets: ['## Chapter 3\n', '## Chapter 4\n'] },
      { name: 'Back Matter', sheets: ['## Notes\n', '## Bibliography\n'] },
    ],
    extras: ['Outline', 'Sources', 'Interviews', 'Scraps'].map((name) => ({ name, sheets: [] })),
  },
  blog: {
    name: 'Blog', icon: 'newspaper', description: 'Ideas, drafts, and what went out.',
    groups: [{ name: 'Drafts', sheets: [] }, { name: 'Ready', sheets: [] }, { name: 'Published', sheets: [] }],
    extras: [{ name: 'Ideas', sheets: [] }, { name: 'Notes', sheets: [] }],
  },
  paper: {
    name: 'Research Paper', icon: 'graduation', description: 'The sections of a paper, and a place for sources.',
    groups: [
      { name: 'Paper', sheets: ['# {title}\n', '## Abstract\n', '## Introduction\n', '## Method\n', '## Results\n', '## Discussion\n', '## References\n'] },
    ],
    extras: [{ name: 'Sources', sheets: [] }, { name: 'Notes', sheets: [] }],
  },
  translation: {
    name: 'Translation', icon: 'translate', description: 'The original and the translation, chapter by chapter, side by side.',
    groups: [{ name: 'Original', sheets: [] }, { name: 'Translation', sheets: [] }],
    extras: [{ name: 'Glossary', sheets: ['# Glossary\n'] }, { name: 'Queries', sheets: [] }, { name: 'Notes', sheets: [] }],
  },
};

export const TEMPLATE_ORDER = ['empty', 'novel', 'nonfiction', 'blog', 'paper', 'translation'];
