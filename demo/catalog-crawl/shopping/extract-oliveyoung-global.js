(() => {
  const observedAt=new Date().toISOString();
  const listingUrl=location.href;
  const category=new URL(location.href).searchParams.get('ctgrNo');
  const names={'1000000008':'Skincare','1000000031':'Makeup'};
  const items=[...document.querySelectorAll('li.prdt-unit')].map(card=>{
    const link=card.querySelector('.unit-desc a[href*="product/detail"]');
    if(!link)return null;
    const externalId=new URL(link.href).searchParams.get('prdtNo');
    const priceText=card.querySelector('.price-info strong')?.textContent.trim();
    const amounts=priceText?.match(/\d+(?:\.\d+)?/g)?.map(Number)||[];
    const rating=card.querySelector('.rating-info')?.textContent.trim();
    return {sourceId:'oliveyoung-global',externalId,kind:'beauty',collectionIds:[`oliveyoung-global-${category}`],
      title:card.querySelector('.brand-info dd')?.textContent.trim(),url:link.href,
      creator:card.querySelector('.brand-info dt')?.textContent.trim(),
      imageUrl:card.querySelector('.unit-thumb img')?.getAttribute('data-src')||card.querySelector('.unit-thumb img')?.getAttribute('src'),
      observedAt,listingUrl,attributes:{category:names[category]||category,categoryCode:category,
        ...(priceText?{displayedPrice:priceText,currency:priceText.startsWith('US$')?'USD':priceText.replace(/[0-9.\s-]/g,''),...(amounts.length===1?{price:amounts[0]}:{priceMin:Math.min(...amounts),priceMax:Math.max(...amounts)})}:{}),
        ...(rating&&/^\d\.\d$/.test(rating)?{rating:Number(rating),ratingScale:5}:{})},
      extraction:'browser-dom',rawVisibleText:card.textContent.replace(/\s+/g,' ').trim()};
  }).filter(i=>i?.title&&i?.externalId);
  return {observedAt,listingUrl,category,items};
})()
