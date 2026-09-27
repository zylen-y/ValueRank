(() => {
 const sourceUrl=location.href;
 const creator=document.querySelector('h1')?.textContent.trim() || document.title.replace(/ - YouTube$/,'');
 const cards=Array.from(document.querySelectorAll('yt-lockup-view-model, ytd-rich-grid-media, ytd-grid-video-renderer'));
 const records=cards.map(card=> {
 const link=card.querySelector('h3 a[href*="watch"],a#video-title[href*="watch"]');
 if(!link)return null;
 const externalId=new URL(link.href).searchParams.get('v');
 const title=card.querySelector('h3')?.getAttribute('title') || link.textContent.trim();
 const duration=card.querySelector('.ytBadgeShapeText,ytd-thumbnail-overlay-time-status-renderer')?.textContent.trim();
 const metadata=card.querySelector('yt-content-metadata-view-model,#metadata-line')?.textContent.replace(/\s+/g,' ').trim();
 const img=card.querySelector('img');
 const imageUrl=img?.currentSrc || img?.src;
 return {title,canonicalUrl:'https://www.youtube.com/watch?v='+externalId,externalId,creator,imageUrl:imageUrl?.startsWith('https://')?imageUrl:undefined,description:'',sourceUrl,source:'YouTube',category:'youtube',collection:creator+' · Videos',attributes:{duration:duration||'',metadata:metadata||''},evidenceText:card.innerText.replace(/\s+/g,' ').trim()};
 }).filter(Boolean);
 return JSON.stringify({sourceUrl,collection:creator+' · Videos',fetchedAt:new Date().toISOString(),method:'browser-dom',records:Array.from(new Map(records.map(r=>[r.externalId,r])).values())});
})()
