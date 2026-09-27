# Screen entertainment and performer photo expansion

Collected on 27 September 2026 using isolated `agent-browser` sessions. The collectors read rendered public pages with `document.querySelector` and normal browser navigation. They do not call Netflix, Wikimedia, or search-provider JSON APIs.

## Netflix public title catalogue

**5,516 unique Netflix title IDs**, deduplicated across the three batches, were observed on **63 public genre pages** reached from the Anime, TV Shows and Movies pages and their actual genre links:

| Batch | Unique titles | Collections | Observed poster URLs |
| --- | ---: | ---: | ---: |
| `netflix-movies.json` | 2,617 | 25 | 2,617 |
| `netflix-series.json` | 2,130 | 22 | 2,130 |
| `netflix-anime.json` | 769 | 8 | 769 |

Entry pages: [Movies](https://www.netflix.com/browse/genre/34399), [TV Shows](https://www.netflix.com/browse/genre/83), [Anime](https://www.netflix.com/browse/genre/7424).

These are **public catalogue observations**, not a complete Netflix inventory, authenticated account recommendations, or a guarantee of playback availability in a particular country. Source card positions are source order, not a popularity or quality score. Images remain remote Netflix poster URLs; the repository does not contain downloaded poster binaries.

The `anime` kind includes Western animation and cartoons. A title observed on an anime/animation/cartoons genre page is allocated there first. Other title IDs are assigned to movies or series according to the majority of explicit movie versus TV/series row labels across their observations. Twenty-five title IDs appeared under both movie and TV row labels; this is a catalogue grouping rather than a title-detail format audit. Every item retains the exact observed section, observed genre page labels, classification basis, listing URL and observation time. No title ID is counted twice across kinds.

The three source batches contain 55 collections, including a complete collected-kind collection and selected public genre pages. Items appearing in several collections remain one database item. Collection membership is capped at 30 as required by the application contract.

Files live in `demo/catalog-crawl/expansion/screen/`:

- `netflix-extract.js`: the DOM-only browser extraction expression.
- `crawl-netflix.mjs`: bounded, resumable navigation of observed public genre links.
- `normalize-netflix.mjs`: deterministic global title-ID deduplication and catalogue grouping.
- `netflix-crawl-report.json`, `netflix-normalization-report.json`: page and data audit.
- `evidence/netflix-<genre-id>.json`: actual page observations used to build the batches.
- `evidence/netflix-catalog.png`, `evidence/netflix-title-cards.png`: browser screenshots.

Reproduce from the repository root:

```sh
node demo/catalog-crawl/expansion/screen/crawl-netflix.mjs
node demo/catalog-crawl/expansion/screen/normalize-netflix.mjs
```

Saved page evidence makes the collector resumable. Move the evidence files aside to request fresh pages; do not silently replace an old observation timestamp with a new time. The crawl stops at its page limit or exhaustion of observed genre links.

## Performer photographs

**310 distinct Commons file pages**, each with an observed photo URL, author and file-specific license, in **26 collections**. There are 25 source category groups: one general actor-portrait category plus 24 named performer categories. This is a count of photos, not 310 different celebrities.

Each accepted Wikimedia Commons photo is backed by an actual file page with an observed image URL, author field and file-specific license. Names come from source-provided filenames, descriptions and categories. No face recognition, inferred age, ethnicity, attractiveness score, personality or biometric embedding is generated. A photo is the ranking item: several photos may depict the same publicly named performer.

Category membership is provenance, not a guarantee that every file is a face crop or headshot. The application uses these images as visual references while its current learner still learns only from source metadata. An image URL alone does not mean the model has analyzed image pixels.


The normalized `commons-portraits.json` is the importable photo batch. Its inputs are the accepted actor-portrait audit (`commons-portraits-raw.json`), the focused modern performer audit (`commons-celebrities-v2-raw.json`), and the observed IU category redirect follow-up (`commons-celebrities-iu-raw.json`). The first broad named-category pass is retained as evidence but excluded from the batch. Source-labeled drawings, paintings, illustrations, signatures, posters, collages, murals, statues, sculptures and wax figures are filtered out. A missing or unlicensed result is never replaced with a generated image.

The focused collector follows actual portrait and recent-year category links, at most 12 category pages and 12 photos per named performer. It visits each selected file page to read its license and author. Three isolated browser sessions run concurrently, and results are deduplicated by the canonical Commons file page. A seed category that does not exist remains an empty attempt; IU's actual source-visible redirect to `Category:IU_(vocalist)` was followed separately. No login was required.

```sh
node demo/catalog-crawl/expansion/screen/crawl-celebrities-v2.mjs
node demo/catalog-crawl/expansion/screen/crawl-iu.mjs
node demo/catalog-crawl/expansion/screen/normalize-portraits.mjs
```

`commons-extract.js` contains the DOM extraction expression. `evidence/commons-<hash>.json` stores the observed category or file page, including the unshortened author, description and license fields. The normalized item retains `creator` (the source photographer/author), `license`, `licenseURLs`, `attribution`, `fileSource`, and `dateAsDisplayed`. These are source statements, not independently adjudicated copyright claims. Open the file page to check the current license before redistributing or editing an image. The displayed remote thumbnail may expire or change independently of the metadata snapshot.

Photographs have no verified adult-only flag. Historical image dates and subject ages are not inferred. The dataset is a collection of publicly source-labeled performer photographs, not a validated face-identification or biometric dataset.

## Local ranking response measurements

A separate temporary SQLite catalogue containing **25,579 actual collected items across 174 collections** was used for backend measurements. The preference database was created empty in that temporary directory; test choices never touched the user's preference ledger. Times below are synchronous service-call durations on the development machine, not browser rendering, network latency, or a production throughput claim.

| Collection | Items | Cold-start page before → after | Learned page before → warm after |
| --- | ---: | ---: | ---: |
| Netflix movies | 2,617 | ~177 ms → ~14 ms | ~181 ms → ~27 ms |
| Netflix TV | 2,130 | ~147 ms → ~11 ms | ~149 ms → ~22 ms |
| Standard Ebooks | 1,522 | ~85 ms → ~7 ms | ~89 ms → ~13 ms |

Five page calls were measured for each case. The first learned call must encode its metadata features and took 150 ms, 105 ms, and 46 ms respectively; subsequent calls reused those immutable feature revisions. The full catalogue summary remained approximately 54 ms.

The optimization reads one collection summary directly instead of rebuilding every collection's summary, reads only the current preference models instead of recomputing a complete personal dashboard, skips feature encoding when all cold-start scores are exactly neutral, and caches at most 8,192 immutable item revisions. **Scores are not cached**: feedback, undo and changed catalogue revisions are reflected immediately. Source/recent pagination scores only the visible slice. Regression checks cover revised metadata, pagination scores, feedback and undo.

A final source-label quality audit removed two captured candidates: an Emma Stone mural photograph and a Musée Grévin wax-figure photograph. Their observed evidence remains available, but neither is imported as a celebrity photograph. All 310 accepted records were checked against their saved file-page image URL, author and license fields with zero mismatches.
