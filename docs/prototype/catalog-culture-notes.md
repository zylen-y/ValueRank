# Culture catalog browser crawl

Collected on 2026-09-27 using the public rendered pages in the `agent-browser` session `catalog-culture`. No login session, private account data, paid API, hidden application payload, audio/video download, or transcript extraction was used.

## Delivered records

| Source | Collection | Browser rows | Unique source records |
| --- | --- | ---: | ---: |
| Apple Music | Top 100: Global | 99 | |
| Apple Music | Top 100: South Korea | 100 | **195** across both charts |
| YouTube | Fireship videos | 150 | 150 |
| YouTube | 3Blue1Brown videos | 150 | 150 |
| YouTube | freeCodeCamp.org videos | 150 | 150 |
| YouTube | Figma videos | 150 | 150 |
| Instagram | Public @figma access probe | 0 | **Blocked** |
| Pinterest | Public minimal-interior-design search probe | 0 | **Blocked** |

**795 unique rankable items**: 195 tracks and 600 videos. The charts overlap by four track IDs. One global-chart row had no usable canonical song link and was excluded rather than guessed. Collection membership retains both charts for overlapping songs.

All 195 tracks and 564 of 600 videos have artwork/thumbnail URLs actually observed in the rendered DOM. Remaining thumbnails were not loaded by the bounded sweep and are absent. URLs are references to the source's media, not copied files or an assertion of redistribution rights. Source CDN URLs may expire; the original item URL remains available.

## Fields and their meaning

Every item has its source, canonical item URL, source listing URL, browser observation timestamp, collection IDs, displayed title, creator, and `extraction: browser-dom`. Track rows retain album, displayed duration, parsed duration in seconds, explicit-content marker, and chart position scoped to the particular chart. Video rows retain displayed duration and the source's display string for view count/relative age. Relative age is not converted into a fabricated publication date. Chart position and view count are source metadata, not personal labels.

Descriptions are short mechanical summaries of the observed creator/album/duration; they do not claim that video or audio content was reviewed. No genres, audio features, semantic embeddings, visual taste features, or model predictions were invented. These records are a real candidate pool for user ranking, not trained user preferences.

## Access barriers

Instagram's public `https://www.instagram.com/figma/` page displayed a signup/login overlay. Pinterest's public `https://www.pinterest.com/search/pins/?q=minimal%20interior%20design` page displayed a mandatory login dialog. Collection stopped at both barriers. No modal removal, authentication bypass, hidden pin payload extraction, profile guessing, or alternate-source substitution was attempted. Their batch files explicitly record `status: blocked` and contain no items.

## Files and reproduction

- `demo/catalog-crawl/culture/apple-music.json`, `youtube.json`: normalized catalog batches.
- `demo/catalog-crawl/culture/instagram.json`, `pinterest.json`: blocked source status.
- `raw/*.browser.json`: exact JSON-string output from browser DOM evaluation; decode the outer JSON string once to read the underlying object.
- `evidence/*.snapshot.txt`: accessibility snapshots showing the pages and login barriers.
- `evidence/*.png`: browser screenshots of representative pages and barriers.
- `apple-dom.js`, `youtube-dom.js`: DOM-only extraction expressions; no network requests or application-internal state reads.
- `normalize.mjs`: deterministic mapping, duplicate handling by external ID, collection union, and source status generation.
- `recollect.sh`: bounded public browser crawl. Run `bash demo/catalog-crawl/culture/recollect.sh` from the repository root. Optional `music` or `youtube` narrows the scope. Read snapshots and stop if a source changes to an access barrier. Rechecking Instagram/Pinterest remains a manual browser inspection, not a bypass loop.

The four video channels were swept in 20 scroll steps of 750 pixels. This is an intentionally bounded collection, not a claim to have crawled each channel's complete history. The source pages may change, so a subsequent collection can produce different counts. The source IDs and item IDs allow later refresh/upsert without turning duplicate listings into extra preference examples.

Validation confirmed unique source IDs, valid canonical URLs, known collection memberships, observation timestamps, and string/number-only attributes. Imported user choices should remain separate from this source metadata.
