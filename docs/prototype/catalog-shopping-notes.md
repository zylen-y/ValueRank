# Shopping catalog capture

Collected **683 unique product records** from actual rendered public shopping pages on 2026-09-27 (KST). Each item stores its observed timestamp, listing URL, canonical product URL, brand, displayed price, remote thumbnail URL, source ID and category membership. No product descriptions, prices, images, ratings or popularity figures were invented.

| Source | Records | Comparable groups | Access result |
| --- | ---: | --- | --- |
| [MUSINSA](https://www.musinsa.com/main/musinsa/ranking) | 443 | Outerwear 184; Pants 130; Shoes 129 | Public browser lists accessible |
| [OLIVE YOUNG Global](https://global.oliveyoung.com/) | 240 | Skincare 144; Makeup 96 | Public browser category lists accessible |
| [OLIVE YOUNG Korea](https://www.oliveyoung.co.kr/store/main/getBestList.do) | 0 | None | Cloudflare human verification challenge; stopped |

The Olive Young global storefront is a **separate inventory and pricing source**, with USD prices. It is not a substitute representation of the Korean domestic catalog. The domestic challenge was neither solved nor bypassed.

MUSINSA was captured with the **NEW ranking** tab, category filters and the public realtime/all-gender/all-age default filters. Ranking order is an observation of that source; it is not ValueRank's assessment or a user's preference. Virtualized lists were scrolled in the browser and captured at each stop. Repeated IDs were deduplicated, resulting in 443 records from 444 observations. Rank gaps and source updates were retained honestly, without padding the sample.

Olive Young Global was captured from the **Most Popular** skincare and makeup lists. Page size was set to 48 using the site's control. The first three skincare pages and first two makeup pages were loaded via the visible MORE control. Ranges remain `priceMin`/`priceMax`; single prices have `price`. `displayedPrice` retains the original currency formatting. Displayed review averages include `ratingScale: 5`; absent ratings stay absent.

Images remain remote source thumbnail URLs. No image bytes were downloaded, licensed, or rehosted. This capture grants no rights to the sellers' photos. Prices can change and may depend on variants or coupons; they are dated listing observations, not checkout quotes. No accounts, carts, payments, or subscriptions were changed.

## Files

All paths below are relative to the repository root.

- `demo/catalog-crawl/shopping/musinsa.json`: normalized import batch.
- `demo/catalog-crawl/shopping/oliveyoung-global.json`: normalized import batch.
- `demo/catalog-crawl/shopping/oliveyoung-korea.json`: explicit blocked-source record with empty items.
- `demo/catalog-crawl/shopping/evidence/`: raw per-page DOM extractions, browser snapshots, and screenshots.
- `demo/catalog-crawl/shopping/extract-musinsa.js`: browser DOM parser.
- `demo/catalog-crawl/shopping/extract-oliveyoung-global.js`: browser DOM parser.
- `demo/catalog-crawl/shopping/normalize.mjs`: deterministic record normalization, deduplication and validation.

## Reproduction

Use a fresh public browser session. If a challenge or login requirement appears, stop collection for that source. Do not use a bypass or a guessed hidden API.

```sh
npx --yes agent-browser --session catalog-shopping open 'https://www.musinsa.com/main/musinsa/ranking'
npx --yes agent-browser --session catalog-shopping snapshot -i
```

Select `아우터`, `바지`, or `신발` using the current snapshot's button refs. Capture the initial list, then scroll down 3,500 pixels and capture after each stop. The original capture used four stops for outerwear and three for each of pants and shoes. Capture before scrolling again because the product grid is virtualized.

```sh
npx --yes agent-browser --session catalog-shopping eval --stdin < demo/catalog-crawl/shopping/extract-musinsa.js
npx --yes agent-browser --session catalog-shopping scroll down 3500
```

For Olive Young Global, open the home page, choose Skincare → All Skincare or Makeup → All Makeup, wait for `.brand-info dd`, then select page size 48. Capture initial results and use the current snapshot's MORE button for additional pages.

```sh
npx --yes agent-browser --session catalog-shopping open 'https://global.oliveyoung.com/'
npx --yes agent-browser --session catalog-shopping snapshot -i
npx --yes agent-browser --session catalog-shopping eval --stdin < demo/catalog-crawl/shopping/extract-oliveyoung-global.js
```

Store captures with the existing filename pattern under `evidence/` and normalize them:

```sh
node demo/catalog-crawl/shopping/normalize.mjs
npx --yes agent-browser --session catalog-shopping close
```

The extraction code reads only rendered product-card fields and their DOM link/image attributes. There is no LLM enrichment, hidden API crawl, fake seed generation or paid model call in this collection.
