(() => {
  const observedAt = new Date().toISOString();
  const listingUrl = location.href;
  const category = new URL(location.href).searchParams.get('categoryCode') || 'all';
  const names = {'002000':'Outerwear', '001000':'Tops', '003000':'Pants', '103000':'Shoes', '004000':'Bags'};
  const items = [...document.querySelectorAll('a[data-item-id][aria-label="상품 상세로 이동"]')].map(a => {
    const card = a.parentElement.parentElement;
    const titleLink = [...card.querySelectorAll('a[data-item-id]')].find(link => link.textContent.trim());
    const brand = card.querySelector('a[data-brand-id]');
    const priceText = [...card.querySelectorAll('[class*="PriceText"]')].map(e=>e.textContent.trim()).find(t=>/원$/.test(t));
    const rankText = card.querySelector('[class*="Rank"]')?.textContent.trim();
    return {
      sourceId: 'musinsa', externalId: a.dataset.itemId, kind: 'fashion',
      collectionIds: [`musinsa-${category}`], title: titleLink?.textContent.trim() || '',
      url: a.href.split('?')[0], creator: brand?.textContent.trim(),
      imageUrl: a.querySelector('img')?.getAttribute('src'), observedAt, listingUrl,
      attributes: {category: names[category] || category, categoryCode:category,
        ...(priceText ? {displayedPrice:priceText, price:Number(priceText.replace(/[^0-9]/g,'')),currency:'KRW'}:{}),
        ...(rankText && /^\d+$/.test(rankText)?{sourceRank:Number(rankText)}:{}),
        brandId: a.dataset.itemBrand || '', rankingTheme:a.dataset.extraInfo || ''},
      extraction: 'browser-dom', rawVisibleText:card.innerText
    };
  }).filter(i=>i.title&&i.url&&i.externalId);
  return {observedAt,listingUrl,category,items};
})()
