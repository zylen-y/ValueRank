# Instagram and Pinterest: authenticated browser capture

On 2026-09-27 the user completed sign-in in their own connected Chrome browser and
explicitly authorized collecting rankable public accounts and images. The capture
used the sites' visible search inputs, result cards and scrolling controls.

| Source | Unique items | Focused collections | All-items pool | Search queries |
| --- | ---: | ---: | ---: | ---: |
| Instagram | 438 accounts | 21 | 1 | 88 |
| Pinterest | 1,045 pins | 14 | 1 | 14 |

All **1,483** records have actual observed remote image URLs, original item links,
listing URLs and observation timestamps. Provider IDs deduplicate overlaps. The
14 Pinterest themes include interiors, web design, typography, branding, Japanese
architecture, streetwear, fashion photography, ceramics, landscape photography,
character illustration, color palettes, cinematic photography, food photography
and workspaces. Instagram groups include language learning, founders, science,
design, photography, music, books, fitness and public-figure-related searches.

These are query-selected samples, not full platform inventories or a claim that
all search results are relevant. The sites may personalize their search results.
Instagram public account cards include creators, businesses and fan accounts.
Displayed verification badges are recorded as an observation; names and badges
are not an independent identity audit. No follow, like, save, post or message action
was used. No private home feed, contact list, messages, cookies or credentials were
retained. Search terms are the collector's research queries, not user preference
labels. No model calls were made and no personal ranking feedback was generated.

Pinterest titles and alternative text are copied from public search cards. Those
labels can be machine-generated, and search results can contain generated imagery,
illustrations and photography together. Browser capture establishes where an item
was observed; it does not establish that an image is an unedited photograph.
Instagram previews are CDN URLs that may expire. Source hosts retain the media;
the repository contains metadata and observed URLs, not downloaded image binaries.

## Evidence and reproduction

The files are in `demo/catalog-crawl/expansion/social/`:

- `captures.jsonl`: public result-card observations only. Includes intermediate
  empty/overlapping viewport observations; these do not inflate normalized counts.
- `instagram.json`, `pinterest.json`: the two validated import batches.
- `normalize.py`: deterministic source-ID deduplication, collection membership and
  normalization. It never contacts a website or invents records.
- `normalization-report.json`: counts from the normalization pass.
- `capture-server.mjs`: temporary localhost-only browser form used to persist the
  result of read-only DOM extraction. It accepts only the local form's origin and
  checks source, listing URL and observation fields before appending captures.
  It is stopped after collection and is not part of the running application.
- `browser-extractors.js`: the read-only DOM extractors used in the connected
  browser. These inspect rendered card elements, not internal APIs or app state.

For a future capture, sign in manually if required, navigate using the site's
visible search controls, and inspect the current result-card DOM before using an
extractor. Instagram returns five account cards per query in this observed UI.
Wait for the loading state to finish before assigning results to the next query;
otherwise previous results can be misattributed. Pinterest virtualizes its list,
so capture each viewport before proceeding. Stop at a challenge or access denial.

The extracted object has `source`, `observedAt`, `url`, `query` and `items`. Save it
through the local capture form using ordinary browser interaction. Normalize with:

```sh
python3 demo/catalog-crawl/expansion/social/normalize.py
```

Run the complete catalog audit from `demo` with:

```sh
node --import tsx catalog-crawl/expansion/audit.mjs
```

Both sources are marked `partial` because this is a bounded sample. The original
failed pre-login attempts remain in the earlier evidence, while the latest source
status and public items reflect this successful authorized capture.
