export function parsePersonalCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) { const character = text[i]; if (character === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; } else if (character === ',' && !quoted) { row.push(cell); cell = ''; } else if (character === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += character; }
  if (quoted) throw new Error('CSV contains an unclosed quote.');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift()?.map(value => value.trim()) || [];
  if (new Set(headers).size !== headers.length) throw new Error('CSV column names must be unique.');
  if (rows.some(values => values.length > headers.length)) throw new Error('A CSV row has more fields than the header.');
  if (!headers.includes('title') || !headers.includes('body')) throw new Error('CSV needs title and body columns. Optional columns: sourceUrl, entityId.');
  return rows.filter(values => values.some(Boolean)).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}
