/** Read-only rendered card extractors; invoke in the authorized browser DOM scope. */
export function instagramCards() {
  return {
    url: location.href,
    query: document.querySelector('input[placeholder="Search"]')?.value,
    items: [...document.querySelectorAll('main a[href]')]
      .filter(a => a.innerText.trim() && /^\/[A-Za-z0-9._]+\/$/.test(a.pathname) && a.querySelector('img'))
      .map(a => ({
        externalId: a.pathname.split('/')[1], url: a.href,
        title: a.innerText.split('\n')[0].trim(),
        description: a.innerText.split('\n').slice(1).join(' ').slice(0, 350),
        imageUrl: a.querySelector('img').currentSrc || a.querySelector('img').src,
        verified: !!a.querySelector('svg[aria-label="Verified"],img[alt="Verified"]'),
      })),
  };
}
export function pinterestCards() {
  return {
    url: location.href, query: document.querySelector('#search-input')?.value,
    items: [...document.querySelectorAll('a[href*="/pin/"]')]
      .filter(a => a.querySelector('img') && /\/pin\/\d+\//.test(a.pathname))
      .map(a => {
        const img = a.querySelector('img');
        return { externalId: a.pathname.split('/')[2], url: a.href,
          title: (a.getAttribute('aria-label') || img.alt || a.innerText).replace(/ pin page$/, '').trim().slice(0, 500),
          imageUrl: img.currentSrc || img.src, alt: img.alt.slice(0, 500),
        };
      }),
  };
}
