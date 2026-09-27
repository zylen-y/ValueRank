/** Temporary localhost form for saving public DOM observations via browser UI.
 * node catalog-crawl/expansion/social/capture-server.mjs
 * Stop after collecting. Does not read or store browser credentials or cookies.
 */
import http from 'node:http';
import { appendFileSync } from 'node:fs';
const path = new URL('./captures.jsonl', import.meta.url);
const origin = 'http://127.0.0.1:8767';
let saved = 0;
const page = () => `<!doctype html><html lang="en"><meta charset="utf-8"><title>ValueRank public capture</title><style>body{font:16px system-ui;max-width:760px;margin:60px auto}textarea{width:100%;height:260px}button{padding:12px 24px;margin-top:16px}</style><h1>Save public catalog observations</h1><p>Only public search result metadata. No credentials or private feeds.</p><form method="post"><label for="capture">Public DOM capture JSON</label><textarea id="capture" name="capture" required></textarea><br><button>Save capture</button></form><p role="status">${saved} captures saved in this session.</p></html>`;
http.createServer(async (req,res)=>{
  if (req.headers.host !== '127.0.0.1:8767') {res.writeHead(403).end();return;}
  if (req.method==='GET') {res.setHeader('content-type','text/html; charset=utf-8');res.end(page());return;}
  if (req.method!=='POST'||req.headers.origin!==origin) {res.writeHead(403).end();return;}
  try {
    let body=''; for await(const chunk of req) {body+=chunk;if(body.length>2_000_000)throw Error('Capture too large');}
    const raw=JSON.parse(new URLSearchParams(body).get('capture'));
    const captures=Array.isArray(raw)?raw:[raw];
    for(const capture of captures){
      const host=new URL(capture.url).hostname;
      if(!['instagram','pinterest'].includes(capture.source)||!Array.isArray(capture.items)||capture.items.length>1000)throw Error('Invalid capture');
      if(capture.source==='instagram'&&!['www.instagram.com','instagram.com'].includes(host))throw Error('Invalid source');
      if(capture.source==='pinterest'&&!host.endsWith('.pinterest.com'))throw Error('Invalid source');
      if(typeof capture.query!=='string'||!capture.observedAt)throw Error('Missing provenance');
    }
    appendFileSync(path,captures.map(x=>JSON.stringify(x)+'\n').join(''));
    saved+=captures.length;res.writeHead(303,{location:'/'}).end();
  }catch(e){res.writeHead(400,{'content-type':'text/plain'}).end(e.message);}
}).listen(8767,'127.0.0.1',()=>console.log('Public capture form at '+origin));
