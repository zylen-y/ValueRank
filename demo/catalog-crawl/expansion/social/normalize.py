"""Normalize actual public search-card observations; no network requests."""
import collections
import html
import json
import pathlib
import re

root = pathlib.Path(__file__).parent
captures = [json.loads(line) for line in (root / 'captures.jsonl').read_text().splitlines()]
groups = {
 'Architecture & interiors': ['architecture','interior','furniture','minimalism'],
 'Graphic design & branding': ['design','graphic design','branding','typography'],
 'Digital product design': ['web design','ui design','framer','figma','product design'],
 'Art & illustration': ['illustration','ceramics','art'],
 'Fashion & streetwear': ['fashion','streetwear','menswear','womenswear','vintage'],
 'Accessories & sneakers': ['sneakers','jewelry'],
 'Beauty & skincare': ['beauty','skincare','makeup'],
 'Photography': ['photography','landscape photography','street photography','film photography'],
 'Travel & nature': ['travel','wildlife','national geographic','nature'],
 'Coffee & food': ['cafe','coffee','baking','cooking','restaurants'],
 'Books & writing': ['books','bookstore','literature','poetry'],
 'Science & technology': ['science','technology','artificial intelligence'],
 'Language learning': ['language learning','english learning','korean learning'],
 'Music & instruments': ['music','jazz','classical music','indie music','guitar','piano'],
 'Cinema & animation': ['cinema','animation','netflix','anime'],
 'Korean actors & pop culture': ['아이유','수지','김지원','한소희','박보검','차은우','정해인','김수현','BLACKPINK','BTS'],
 'Global actors & musicians': ['Taylor Swift','Zendaya','Timothee Chalamet','Emma Watson','Dua Lipa','Billie Eilish','Ryan Reynolds','Margot Robbie','Sabrina Carpenter','Bruno Mars'],
 'Fitness & movement': ['fitness','running','yoga'],
 'Games & game design': ['gaming','game design'],
 'Founders & startups': ['startups','founders'],
 'Seoul & Tokyo': ['seoul','tokyo'],
}
slug = lambda value: re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')
report = {}
for source in ['instagram', 'pinterest']:
    observations = [row for row in captures if row['source'] == source and row['items']]
    by_id = {}
    memberships = collections.defaultdict(set)
    queries = collections.defaultdict(set)
    labels = {}
    for capture in observations:
        query = capture['query']
        label = next((name for name, values in groups.items() if query in values), query) if source == 'instagram' else query
        collection_id = source + '-' + slug(label)
        labels[collection_id] = label
        for item in capture['items']:
            if not item.get('title') or not item.get('imageUrl', '').startswith('https://'):
                continue
            key = item['externalId']
            memberships[key].update([collection_id, source + '-all'])
            queries[key].add(query)
            attributes = {'discoveryQuery': query, 'titleBasis': 'visible search card', 'mediaStorage': 'observed remote URL; may expire'}
            if source == 'instagram':
                attributes['verifiedBadgeObserved'] = str(item.get('verified', False)).lower()
                attributes['accountType'] = 'unverified classification; may include creator, brand or fan account'
            else:
                attributes['sourceAltText'] = item.get('alt', '')
                attributes['imageOrigin'] = 'Pinterest search; photography, illustration and generated imagery may coexist'
            by_id[key] = {
              'sourceId': source, 'externalId': key, 'kind': source,
              'collectionIds': [], 'title': html.unescape(item['title']).strip()[:500],
              'url': item['url'], 'imageUrl': item['imageUrl'],
              'observedAt': capture['observedAt'], 'listingUrl': capture['url'],
              'extraction': 'browser-dom', 'attributes': attributes,
              **({'description': item['description']} if item.get('description') else {}),
            }
    for key, item in by_id.items():
        item['collectionIds'] = sorted(memberships[key])
        item['attributes']['discoveryQueries'] = ' | '.join(sorted(queries[key]))[:2000]
    collections_list = [{'id':source+'-all','title':'Instagram accounts' if source=='instagram' else 'Visual inspiration on Pinterest','kind':source,'description':'A diverse pool of public search results. Choose a focused collection to compare similar items.'}]
    for key, label in labels.items():
        collections_list.append({'id':key,'title':label + (' accounts' if source=='instagram' else ''),'kind':source,'description':f'Public search results related to {label}. '+('Includes creator, brand and fan accounts; identity is not independently verified.' if source=='instagram' else 'Compare visual references and open each pin for its original context.')})
    batch = {'source': {'id':source, 'label':source.title(), 'homeUrl':'https://www.'+source+'.com/', 'kind':source, 'status':'partial', 'checkedAt':max(row['observedAt'] for row in observations), 'note':'Public search cards observed in a user-authorized, signed-in Chrome session. Query-selected sample, not an exhaustive crawl. No private feed, messages, cookies or credentials stored. Remote image URLs may expire. '+('Search account labels and visible verification badges are preserved without asserting official identity.' if source=='instagram' else 'Source-provided titles and alt text may be machine-generated; pins may include AI imagery. No image content was generated for this catalog.')}, 'collections':collections_list, 'items':list(by_id.values())}
    (root / (source+'.json')).write_text(json.dumps(batch, ensure_ascii=False, indent=2)+'\n')
    report[source]={'uniqueItems':len(by_id),'collections':len(collections_list),'queries':len({row['query'] for row in observations}),'nonemptyCaptures':len(observations),'images':sum(bool(i['imageUrl']) for i in by_id.values())}
(root/'normalization-report.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
