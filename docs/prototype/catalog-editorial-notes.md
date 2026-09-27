# Browser-collected book and paper catalog

Collected on 2026-09-27 with the `agent-browser` CLI in the isolated `catalog-editorial` browser session. These are real public website records, not LLM-generated titles or synthetic examples. No paid APIs or account credentials were used.

| Source | Unique items | Collection pages | Result |
| --- | ---: | ---: | --- |
| [arXiv](https://arxiv.org/search/) | 549 papers | 3 pages, 200 cards each | Collected |
| [Standard Ebooks](https://standardebooks.org/ebooks) | 389 books | 10 pages, at most 48 cards each | Collected |
| [Open Library](https://openlibrary.org/search) | 0 retained items | Discovery plus unsuccessful collection requests | Human verification; stopped |
| **Total** | **938** | **13 successful collection pages** | **All retained items extracted from browser DOM** |

The arXiv cohorts contain 200 reinforcement-learning results, 200 AI-agent results, and 200 language-learning results. The 600 collection memberships resolve to 549 unique arXiv identifiers. These are public keyword search cohorts, ordered by recent announcement, rather than a claim that every result has been manually classified or quality reviewed.

The Standard Ebooks cohorts contain 86 philosophy books, 96 nonfiction books, 100 science-fiction books, and 136 mystery books. Overlapping subjects resolve to 389 unique edition/translation URLs. Every retained book has a real cover URL, an author, word count, and reading-ease score present in the website's list view. Word count and reading ease are publisher-provided metadata, not ValueRank model judgments. These books are primarily classics, not a contemporary technical-book catalog.

Open Library initially displayed a normal public search page with 20 book cards. Subsequent collection navigation displayed a “Human Verification” page. Collection was stopped without interacting with the verification button, using an authenticated session, or substituting an API to get around the gate. No book cards from this unsuccessful source are counted in the database batch. The catalog instead uses the independently accessible Standard Ebooks website.

## Files and reproducibility

- `demo/catalog-crawl/editorial/arxiv.json`: normalized paper batch.
- `demo/catalog-crawl/editorial/standard-ebooks.json`: normalized book batch.
- `demo/catalog-crawl/editorial/open-library.json`: blocked source record with zero items.
- `demo/catalog-crawl/editorial/*-crawl-report.json`: visited URLs, observation timestamps, and per-page counts.
- `demo/catalog-crawl/editorial/evidence/*.json`: metadata as extracted on each observed listing page.
- `demo/catalog-crawl/editorial/evidence/*-snapshot.txt`: actual browser accessibility snapshots for the first page of each cohort, plus the Open Library verification page.
- `demo/catalog-crawl/editorial/evidence/standard-ebooks-browser.png`: actual browser screenshot of a collected book listing.

Run from the repository root with an installed or available `agent-browser` CLI:

```sh
SOURCE=arxiv node demo/catalog-crawl/editorial/collect.mjs
node demo/catalog-crawl/editorial/collect-standard-ebooks.mjs
```

The scripts navigate the browser, inspect the currently rendered DOM with `agent-browser eval`, and serialize observed card metadata. They do not call search/content APIs. Pagination is bounded and sequential, with a delay between pages. Missing expected result cards stop a source so the collector does not repeatedly attempt blocked pages. Results may change when rerun because websites and search order change.

## Data boundary and checks

Each item preserves its provider identifier, canonical item URL, collection memberships, observed title and creators, source listing URL, observation timestamp, and `extraction: "browser-dom"`. Paper descriptions are brief excerpts capped at 280 characters; book descriptions contain only visible list metadata. Paper full texts, full abstracts, ebook contents, and cover image binaries are not stored. Image URLs reference the actual image elements on the source page. Displaying linked covers does not imply ownership of the underlying artwork.

Validation confirmed 938 unique source identifiers, no duplicate identifiers within a provider, and complete titles, canonical URLs, creators, timestamps, and extraction labels. All 389 book records contain cover URLs, word counts, and reading-ease values. Collections overlap intentionally; summing collection memberships overstates the unique catalog size. arXiv submission notices and search descriptions are source observations rather than independently verified claims about publication or acceptance.
