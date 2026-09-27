# Lifestyle catalog expansion: browser provenance

This expansion captures public, rendered catalog cards from MUSINSA, OLIVE YOUNG Global, Apple Music, and YouTube. It uses actual browser navigation, category controls, scrolling and visible pagination. It does not use private APIs, invented item IDs, generated item descriptions, downloaded media binaries, or paid model calls.

## Sources and coverage

| Source | Batch unique items | New vs original batch | Collections | Actual thumbnail URLs |
| --- | ---: | ---: | ---: | ---: |
| oliveyoung-global | 2,436 | 2,226 | 8 | 2,436 |
| musinsa | 6,911 | 6,613 | 10 | 6,911 |
| apple-music | 1,909 | 1,803 | 30 | 1,909 |
| youtube | 2,892 | 2,892 | 12 | 1,818 |

The expansion adds **13,534 new source items** after cross-checking original provider IDs. 14,148 records are present in these four import files; their overlap with earlier captures is not counted twice.

The authoritative counts are in `demo/catalog-crawl/expansion/lifestyle/normalized-report.json`. `items` means unique source item IDs in this expansion batch; `newUnique` excludes IDs already in the original shopping/culture batches. Shared products and tracks have multiple collection memberships and count once.

- **MUSINSA:** 10 category groups: tops, bags, hats, accessories, dresses/skirts, outerwear, pants, shoes, sports/leisure, and underwear/loungewear. The visible NEW ranking tab and all-genders/all-ages realtime defaults were used. Approximately 700 unique products per group were captured; the last viewport can pass that bound. Virtualized card views were recorded before each scroll. Capture stops after three unchanged observations or 38 scroll stops. Overlap between groups is deduplicated by real product ID. All prices are observed Korean-won display prices; coupon or variant conditions can change checkout prices.
- **OLIVE YOUNG Global:** eight groups: skincare, makeup, bath/body, hair, masks, sun care, makeup brushes/tools, and men's care. Category links were discovered on the public storefront. The site's visible 48-items control was selected, followed by up to seven pages through MORE. All prices are observed USD display prices; option ranges remain ranges. This is the official **global** storefront and is not labeled as domestic Korean inventory. The previous domestic access barrier was not bypassed.
- **Apple Music:** 30 regional Daily Top 100 lists. Playlist URLs were discovered through New → Charts → Daily Top 100 and saved in browser evidence. Country diversity includes Japan, China, Brazil, Egypt, Ghana, Mexico, France, Germany, Russia and others. Song IDs identify tracks; overlap is deduplicated. Source chart positions remain explicit chart metadata and do not imply personal relevance. An unavailable track can make a chart smaller than 100.
- **YouTube:** bounded public channel grids covering TED talks, Vox explainers, Veritasium and Kurzgesagt science, National Geographic, MKBHD consumer technology, The School of Life, Crash Course, Epicurious cooking, Architectural Digest interiors, linguamarina English learning, and Y Combinator startups. Relative age and view counts remain capture-time strings. No videos or transcripts were copied. Architectural Digest's actual `@Archdigest` handle was resolved through rendered YouTube search results after the longer handle was unavailable. Absent lazy-loaded image attributes are left absent instead of inventing thumbnail URLs.

Each record retains the actual source URL, listing URL, observation time, provider ID, title, creator/brand where shown, collection membership, and observed remote thumbnail URL where present. Brand, album, duration, displayed price and rating are retained only when visible in the source card. Item descriptions are short mechanical summaries of those observed fields, not LLM enrichment. Thumbnail URLs confer no redistribution rights over the underlying photos or artwork; image bytes are not stored or rehosted here.

## Files

Under `demo/catalog-crawl/expansion/lifestyle/`:

- `musinsa.json`, `oliveyoung-global.json`, `apple-music.json`, `youtube.json`: normalized import batches.
- `evidence/*.browser.json`: actual DOM metadata captures with source/time context. Shopping files combine deduplicated observed cards and per-scroll/page capture logs.
- `evidence/*.snapshot.txt`: browser accessibility snapshots used to inspect real controls and categories.
- `evidence/*-links.browser.json`: category/chart URL discovery from actual DOM anchors.
- `*-report.json`: capture counts and bounded navigation reports. Reports are not import batches.
- `collect-musinsa.mjs`, `collect-oliveyoung.mjs`, `collect-apple.mjs`, `collect-youtube.mjs`: bounded browser collection scripts.
- `normalize.mjs`: deterministic normalization and source-ID deduplication. It does not fetch the network.

## Reproduction

Run from the repository root with Node.js and the `agent-browser` CLI available. Public capture sessions have distinct names; they do not consume the user's authenticated Instagram/Pinterest session. Stop if a source introduces a login requirement, CAPTCHA, denial or human verification screen. No collector is a barrier bypass.

```sh
node demo/catalog-crawl/expansion/lifestyle/collect-musinsa.mjs
node demo/catalog-crawl/expansion/lifestyle/collect-apple.mjs
node demo/catalog-crawl/expansion/lifestyle/collect-oliveyoung.mjs
node demo/catalog-crawl/expansion/lifestyle/collect-youtube.mjs
node demo/catalog-crawl/expansion/lifestyle/normalize.mjs
```

Apple Music and Olive Young scripts consume the recorded DOM-discovered listing URLs. Re-discover those links through the public browser directory before a future recrawl if the site changes. Each script navigates listing pages in sequence with bounded pacing. These captures are dated snapshots, not a continuously refreshed feed or an exhaustive market index. Existing source IDs ensure repeat import does not inflate item counts; metadata changes become revisions in the catalog store.

No private preference data, training labels, account details, purchases, follows, messages or subscriptions were created or changed. These are rankable source items for later user feedback; collection itself does not train a personalized model.
