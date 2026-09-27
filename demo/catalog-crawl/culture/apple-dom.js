(() => {
 const sourceUrl = location.href;
 const collection = document.querySelector('h1')?.innerText?.trim() || document.title;
 return JSON.stringify({sourceUrl, collection, fetchedAt:new Date().toISOString(), method:'browser-dom', records:Array.from(document.querySelectorAll('[data-testid="track-list-item"]')).map((row,index)=> {
 const track = row.querySelector('[data-testid="track-title"]');
 const canonicalUrl = track?.closest('a')?.href;
 const artists = Array.from(row.querySelectorAll('[data-testid="track-column-secondary"] a')).map(a=>a.textContent.trim()).filter(Boolean);
 const artwork = row.querySelector('picture source')?.getAttribute('srcset')?.split(',').map(s=>s.trim().split(' ')[0]).at(-1);
 return {title:track?.textContent.trim(),canonicalUrl,creator:artists.join(', '),imageUrl:artwork,description:'',sourceUrl,source:'Apple Music',category:'music',collection,externalId:canonicalUrl?.split('/').at(-1),attributes:{album:row.querySelector('[data-testid="track-column-tertiary"]')?.textContent.trim(),duration:row.querySelector('time')?.textContent.trim(),durationIso:row.querySelector('time')?.getAttribute('datetime'),chartPosition:row.querySelector('[data-testid="track-ranking"]')?.textContent.trim() || String(index+1),explicit:row.getAttribute('aria-label')?.startsWith('Explicit,') || false},evidenceText:row.innerText.replace(/\s+/g,' ').trim()};
 }).filter(r=>r.title&&r.canonicalUrl)});
})()
