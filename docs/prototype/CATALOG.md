# Real-web ranking catalog

ValueRank now starts with a browsable **Library** of real candidates, so a user can
compare similar things and improve a personal order without running a new web search.
The first browser capture on **2026-09-27** contains **2,416 unique items in 18
collections**. This is a bounded snapshot, not a complete copy of these platforms.

![ValueRank Library](catalog-library.png)

## What was collected

| Domain | Source | Unique items | Comparable collections |
| --- | --- | ---: | --- |
| Music | Apple Music | 195 | Global chart, South Korea chart |
| Videos | YouTube | 600 | Fireship, 3Blue1Brown, freeCodeCamp, Figma; 150 each |
| Fashion | MUSINSA | 443 | Outerwear 184, pants 130, shoes 129 |
| Beauty | OLIVE YOUNG Global | 240 | Skincare 144, makeup 96 |
| Books | Standard Ebooks | 389 | Philosophy, nonfiction, science fiction, mystery |
| Papers | arXiv | 549 | Reinforcement learning, AI agents, language learning; 200 memberships each |
| **Total** | **6 collected sources** | **2,416** | **18 collections** |

Overlapping charts, subjects and search cohorts share one item record. Collection
membership counts therefore exceed unique item counts. arXiv groups are keyword
search cohorts, not expert quality labels. The books are mainly classic public-domain
editions, not a modern technical-book catalog. OLIVE YOUNG **Global has USD pricing**;
MUSINSA has KRW pricing. Global is a different storefront from OLIVE YOUNG Korea.

Instagram and Pinterest displayed mandatory login dialogs. OLIVE YOUNG Korea and
Open Library displayed human-verification challenges. Those four source attempts
remain visible as **blocked, zero collected items**. No barrier was bypassed, and no
alternative source was relabeled as one of those platforms.

Capture evidence and reproduction details:

- [Music, YouTube, Instagram and Pinterest](catalog-culture-notes.md)
- [MUSINSA and OLIVE YOUNG](catalog-shopping-notes.md)
- [Books and papers](catalog-editorial-notes.md)

The normalized batches, DOM extraction scripts, raw observations and browser
snapshots live in [`demo/catalog-crawl`](../../demo/catalog-crawl). All retained
items have `extraction: browser-dom`. No LLM authored the catalog titles, prices,
creators or source links. No paid model calls were used for this collection.

## The ranking loop

1. Browse a collection, inspect an item and follow its original link. Filter by
   title, creator, brand or other observed metadata.
2. Click **Teach your ranking**, or select two or more specific items and compare
   that selection. Large collections use a bounded learning set of at most 200;
   selecting items explicitly can train on other parts of the collection.
3. A comparison records the displayed item versions, prediction and actual choice.
   Choosing A, B or a tie updates the category's local pairwise ranking head.
   Neither/skip records no invented directional label.
4. The whole collection is rescored immediately, including candidates outside the
   learning set. Return to the ranking to see changes. Undo rebuilds the head from
   the remaining choices. Memory contains the same comparison history and exports.

![Compare two actual catalog items](catalog-comparison.png)

Additional verified views: [collection grid](catalog-collection.png) and
[390-pixel mobile layout](catalog-mobile.png).

Before personal labels exist, the UI displays collection encounter order. This is
not necessarily the original website's exact chart position after cross-collection
deduplication; observed chart positions are preserved separately in item attributes.
Source popularity is never treated as a personal preference label.

The current catalog encoder is a **56-feature metadata baseline**: 48 lexical hash
features plus presence/value pairs for price, year, duration and rating where those
fields exist. A separate head is maintained for each item kind and feature schema.
Music choices do not train the fashion head. Ranking scores are relative utilities,
not calibrated probabilities or proof that the model understands someone's taste.

Thumbnails make comparison possible, but **catalog image pixels, audio and video
have not been encoded**. The system cannot yet infer visual or musical taste from
these metadata alone. The existing Search experience uses LLM + Jev, and Arena has
an explicit vision-import pipeline; the new catalog does not silently run either
over thousands of items. Hosted Jev weights are not fine-tuned. A future enrichment
pass should create a new versioned feature schema and retain these observations and
labels, then evaluate the improvement on genuinely withheld items.

Catalog datasets are learning-only. Items have already been browsable; pretending
they were an unseen test set would inflate an evaluation. The existing Arena blind
test mechanism remains available for separately partitioned imports.

## Storage and reproducibility

The public candidate database is `.data/catalog.sqlite`, separate from private
`.data/personal.sqlite`. Node's built-in SQLite stores sources, collections, item
identities, immutable content versions, memberships and import runs. Provider ID
(or canonical URL) determines identity. Exact batch replay is idempotent. New
observations update `lastSeenAt`; content changes create a revision. Older captures
cannot overwrite newer content. Historical comparison inputs remain unchanged.

The app imports the ten recorded batches at startup, without opening a browser or
calling an AI provider. Recollecting the web is an explicit operation using the
documented browser scripts; there is no recurring crawl or background inference.

```sh
cd demo
npm run catalog:import                         # Import bundled observations
npm run catalog:import -- /path/new-batch.json  # Validate and upsert one source batch
npm run catalog:stats
npm run catalog:export -- /tmp/valuerank-catalog.json
```

`VALUERANK_CATALOG_DB_PATH` selects another database; `:memory:` is useful in tests.
`VALUERANK_SKIP_CATALOG_SEEDS=1` suppresses bundled imports on server startup.
Deleting private learning data does not delete the separate public catalog.

HTTP endpoints on the existing loopback-only API:

- `GET /api/catalog`: source status, exact unique counts and collections.
- `GET /api/catalog/collections/:id`: paginated items; `query`, `sort=personal|source|recent`,
  `offset` and `limit` (at most 60).
- `POST /api/catalog/collections/:id/practice`: create/reuse a learning set and pair;
  optional `itemIds` selects 2–200 members of that collection.
- `GET /api/catalog/export`: download the current public metadata snapshot. Personal
  observations and training records use the separate Memory export.

Every item retains its original URL, listing URL, browser observation timestamp and
available thumbnail URL. Media binaries are not downloaded or rehosted. Remote
thumbnails may expire or stop loading. Prices, availability and popularity are
dated observations, not current checkout quotes. Full books, articles, papers,
audio and video are not copied into this database.

SQLite is sufficient for this local snapshot and avoids an external dependency.
Moving to a shared Supabase deployment later requires account isolation for private
choices, separate public-catalog tables, storage migration, and incremental crawl
workers. It is not necessary to connect Supabase to try this version.

## Verification

Catalog tests exercise batch validation, transaction rollback, duplicate membership,
idempotency, immutable revisions, stale captures, durable reopening, blocked-source
integrity, neutral cold start, a real choice changing ranking, undo and category
isolation. All 18 captured collections also open valid comparison pairs in isolated
stores. Browser verification and the final full-suite result are recorded in
`catalog-verification.json`. Test choices never enter the user's private database.
