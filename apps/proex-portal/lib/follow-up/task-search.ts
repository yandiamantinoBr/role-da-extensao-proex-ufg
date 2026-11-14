import { text } from './contracts';

// SQLite lower() handles ASCII. Fold the Portuguese letters and their
// decomposed marks in SQL so existing tasks and both database runtimes work.
const groups = {
  a: 'ÀÁÂÃàáâã',
  c: 'Çç',
  e: 'ÉÊéê',
  i: 'Íí',
  o: 'ÓÔÕóôõ',
  u: 'ÚÜúü',
  '': '\u0300\u0301\u0302\u0303\u0308\u0327',
};
const substitutions = Object.entries(groups).flatMap(([letter, marks]) =>
  Array.from(marks, mark => [mark, letter] as const),
);
const accentClass = new RegExp(`[${substitutions.map(([mark]) => mark).join('')}]`, 'g');
const equivalents = new Map<string, string>(substitutions);

function foldedColumn(column: string): string {
  const translated = substitutions.reduce(
    (sql, [mark, letter]) => `replace(${sql},'${mark}','${letter}')`,
    column,
  );
  return `lower(${translated})`;
}

const expressions = {
  t: [foldedColumn('t.title'), foldedColumn('t.body')],
  f: [foldedColumn('f.title'), foldedColumn('f.body')],
};

export function taskSearch(alias: keyof typeof expressions, input: unknown) {
  const term = text(input, 120, true)
    .replace(/[A-Z]/g, letter => letter.toLowerCase())
    .replace(accentClass, mark => equivalents.get(mark)!);
  if (!term) return null;
  const [title, body] = expressions[alias];
  return { sql: `(instr(${title},?)>0 OR instr(${body},?)>0)`, values: [term, term] };
}
