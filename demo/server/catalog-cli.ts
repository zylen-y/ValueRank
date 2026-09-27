import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCatalogStore } from './catalog-store.ts';
import { seedCatalog } from './catalog-seed.ts';
const store = createCatalogStore(process.env.VALUERANK_CATALOG_DB_PATH || undefined);
try {
  const [command = 'stats', ...args] = process.argv.slice(2);
  if (command === 'import') {
    const runs = args.length ? args.map(file => ({ file, ...store.ingest(JSON.parse(readFileSync(resolve(file), 'utf8'))) })) : seedCatalog(store);
    console.log(JSON.stringify({ runs, total: store.summary().total }, null, 2));
  } else if (command === 'stats') console.log(JSON.stringify(store.summary(), null, 2));
  else if (command === 'export') {
    if (args.length !== 1) throw new Error('Usage: npm run catalog:export -- /path/catalog.json');
    writeFileSync(resolve(args[0]), JSON.stringify(store.exportData(), null, 2) + '\n');
    console.log(`Exported ${store.summary().total} public metadata records.`);
  } else throw new Error('Use import, stats, or export.');
} finally { store.close(); }
