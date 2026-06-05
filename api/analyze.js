// ResellCheck – Serverless API Function (Vercel)
const https = require('https');

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}


function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms))
  ]);
}

function appendEbayAffiliate(url) {
  if (!process.env.EBAY_AFFILIATE_CAMPAIGN_ID) return url;
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'mkcid=1&mkrid=707-53477-19255-0&siteid=77&campid=' +
    process.env.EBAY_AFFILIATE_CAMPAIGN_ID + '&toolid=10001&mkevt=1';
}

function buildEbaySearchUrl(query) {
  const base = 'https://www.ebay.de/sch/i.html?_nkw=' + encodeURIComponent(query);
  return appendEbayAffiliate(base);
}

function buildAmazonSearchUrl(query) {
  let base = 'https://www.amazon.de/s?k=' + encodeURIComponent(query);
  if (process.env.AMAZON_ASSOCIATE_TAG) base += '&tag=' + process.env.AMAZON_ASSOCIATE_TAG;
  return base;
}

async function identifyObject(base64Image) {
  const result = await httpsPost(
    'api.openai.com', '/v1/chat/completions',
    { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model: 'gpt-4o', max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'auto' } },
          { type: 'text', text: 'Identify this object. Respond ONLY with valid JSON (no markdown):\n{"objectName":"Produktname auf Deutsch","category":"Elektronik|Kleidung|Spielzeug|Moebel|Schmuck|Uhren|Sport|Buecher|Haushalt|Sonstiges","brand":"Marke oder null","condition":"Neu|Sehr gut|Gut|Akzeptabel|Beschaedigt","ebaySearchQuery":"best english ebay search max 5 words","confidence":0}' }
        ]
      }]
    }
  );
  if (result.status !== 200) throw new Error('OpenAI Fehler: ' + JSON.stringify(result.body));
  const content = result.body.choices?.[0]?.message?.content || '{}';
  const clean = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  return JSON.parse(clean);
}

async function identifyWithBrand(base64Image, userBrand, userModel, userSize, userCategory) {
  const contextParts = [
    `Marke: ${userBrand}`,
    userModel ? `Modell: ${userModel}` : null,
    userSize  ? `Grösse: ${userSize}`  : null,
    userCategory ? `Kategorie: ${userCategory}` : null,
  ].filter(Boolean).join(', ');

  const prompt = `Du analysierst einen Flohmarkt-Artikel mit folgenden Nutzerangaben: ${contextParts}.

Kombiniere dein Markenwissen über "${userBrand}" (Produktkategorien, typische Artikel, Preisrange) mit der visuellen Analyse des Fotos.

Identifiziere so präzise wie möglich:
- Exakter Produkttyp (z.B. "Hoodie", "Laufschuh", "Lederjacke")
- Modell/Linie falls sichtbar (z.B. "Box Logo", "Air Force 1", "501")
- Farbe/Colorway
- Zustand basierend auf dem Foto
- Optimierter eBay.de Suchbegriff: Marke + Produkttyp + Modell + Farbe (5-8 Wörter, kein Artikel, KEINE Grösse)

Antworte NUR als JSON (kein Markdown):
{
  "objectName": "vollständiger Produktname auf Deutsch",
  "category": "Kleidung|Schuhe|Elektronik|Schmuck|Uhren|Moebel|Haushalt|Spielzeug|Buecher|Sport|Musik|Sonstiges",
  "brand": "${userBrand}",
  "productLine": "Modell/Linie oder null",
  "color": "Farbe",
  "condition": "Sehr gut",
  "ebaySearchQuery": "Obey Box Logo Hoodie schwarz",
  "confidence": 90
}`;

  const result = await httpsPost(
    'api.openai.com', '/v1/chat/completions',
    { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model: 'gpt-4o', max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'auto' } }
        ]
      }]
    }
  );
  if (result.status !== 200) throw new Error('OpenAI Brand-Vision Fehler: ' + JSON.stringify(result.body));
  const content = result.body.choices?.[0]?.message?.content || '{}';
  const clean = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  const parsed = JSON.parse(clean);
  // Merge user-provided size back (for display, not for search query)
  if (userSize) parsed.size = userSize;
  if (userCategory && !parsed.category) parsed.category = userCategory;
  return parsed;
}

async function getEbayPrices(searchQuery) {
  const credentials = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const tokenRes = await new Promise((resolve, reject) => {
    const body = 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope';
    const req = https.request(
      { hostname: 'api.ebay.com', path: '/identity/v1/oauth2/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${credentials}`, 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let raw=''; res.on('data',(c)=>raw+=c); res.on('end',()=>resolve(JSON.parse(raw))); }
    );
    req.on('error', reject); req.write(body); req.end();
  });
  if (!tokenRes.access_token) throw new Error('eBay Auth fehlgeschlagen');

  const encoded = encodeURIComponent(searchQuery);
  const headers = { Authorization: `Bearer ${tokenRes.access_token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE', 'Content-Type': 'application/json' };

  // Note: eBay condition filter removed - curly braces in URL cause API rejection
  const searchRes = await httpsGet('api.ebay.com',
    `/buy/browse/v1/item_summary/search?q=${encoded}&limit=50&sort=price`,
    headers);

  const items = searchRes.body?.itemSummaries || [];
  if (items.length === 0) return null;

  let prices = items.map(i=>parseFloat(i.price?.value||0)).filter(p=>p>0).sort((a,b)=>a-b);

  // Two-pass outlier removal (works across all categories):
  // Pass 1: remove extreme low-end (below 8% of max) – catches accessories/parts
  const maxPrice = prices[prices.length - 1];
  prices = prices.filter(p => p >= maxPrice * 0.08);
  if (prices.length === 0) return null;
  // Pass 2: remove items below 30% of mean of cleaned set – catches remaining outliers
  if (prices.length > 3) {
    const mean = prices.reduce((a,b) => a+b, 0) / prices.length;
    const filtered = prices.filter(p => p >= mean * 0.30);
    if (filtered.length >= 3) prices = filtered;
  }
  if (prices.length === 0) return null;

  // Trim top/bottom 10% for avg
  const t = Math.floor(prices.length * 0.1);
  const trimmed = prices.slice(t, prices.length - t > 0 ? prices.length - t : prices.length);
  const avg = trimmed.reduce((a,b)=>a+b,0) / trimmed.length;

  // Min/Max from 10th and 85th percentile of cleaned dataset
  const min = prices[Math.floor(prices.length * 0.10)];
  const max = prices[Math.floor(prices.length * 0.85)];

  // Collect top 3 representative listings (near median price)
  const medianPrice = prices[Math.floor(prices.length / 2)];
  const topListings = items
    .filter(i => {
      const p = parseFloat(i.price?.value || 0);
      return p >= medianPrice * 0.5 && p <= medianPrice * 2;
    })
    .slice(0, 3)
    .map(i => ({
      title: i.title ? i.title.substring(0, 60) : '',
      price: parseFloat(i.price?.value || 0).toFixed(2),
      currency: i.price?.currency || 'EUR',
      url: i.itemWebUrl ? appendEbayAffiliate(i.itemWebUrl) : null,
      condition: i.condition || null
    }));

  return { priceMin: min.toFixed(2), priceMax: max.toFixed(2), marketAvg: avg.toFixed(2), listingCount: prices.length, aiEstimate: false, topListings };
}

function analyzeDemandAndChannels(objectInfo, ebayData) {
  const listingCount = ebayData?.listingCount || 0;
  let demandScore = Math.min(100, Math.round((listingCount/20)*100));
  if (listingCount >= 15) demandScore = Math.max(demandScore, 70);
  if (listingCount >= 8) demandScore = Math.max(demandScore, 45);
  if (listingCount === 0) demandScore = 15;
  const demandLabel = demandScore>=70?'Hohe Nachfrage':demandScore>=40?'Mittlere Nachfrage':'Niedrige Nachfrage';
  const timeToSell = demandScore>=70?'1-7 Tage':demandScore>=40?'1-4 Wochen':'1-3 Monate';

  const cat = (objectInfo.category||'').toLowerCase();
  let channels;
  if (cat.includes('elektron')||cat.includes('handy')) {
    channels = [{name:'Ricardo.ch',reason:'Grösster CH-Marktplatz für Elektronik'},{name:'eBay.de',reason:'Grosse Reichweite in DACH'},{name:'Facebook Marketplace',reason:'Lokal & schnell'}];
  } else if (cat.includes('kleider')||cat.includes('mode')||cat.includes('kleidung')||cat.includes('schuhe')) {
    channels = [{name:'Vinted',reason:'Beste Plattform für Mode & Schuhe in CH'},{name:'Ricardo.ch',reason:'Grosse Reichweite in CH'},{name:'Facebook Marketplace',reason:'Lokal & kostenlos'}];
  } else if (cat.includes('schmuck')) {
    channels = [{name:'Ricardo.ch',reason:'Gut für Schweizer Käufer'},{name:'Catawiki',reason:'Spezialisiert auf Sammlerstücke'},{name:'eBay.de',reason:'Internationale Reichweite'}];
  } else if (cat.includes('uhren')) {
    channels = [{name:'Chrono24',reason:'Weltgrösste Uhren-Plattform'},{name:'Ricardo.ch',reason:'Gut für Schweizer Käufer'},{name:'eBay.de',reason:'Internationale Reichweite'}];
  } else if (cat.includes('moebel')) {
    channels = [{name:'Facebook Marketplace',reason:'Ideal für Möbel (Abholung)'},{name:'Tutti.ch',reason:'Starke lokale Präsenz in CH'},{name:'Ricardo.ch',reason:'Bekannter CH-Marktplatz'}];
  } else if (cat.includes('haushalt')) {
    channels = [{name:'Ricardo.ch',reason:'Grosse Reichweite in CH'},{name:'Tutti.ch',reason:'Lokal & kostenlos'},{name:'Facebook Marketplace',reason:'Schnell & direkt'}];
  } else if (cat.includes('spielzeug')) {
    channels = [{name:'Ricardo.ch',reason:'Top-Plattform für Spielzeug in CH'},{name:'eBay.de',reason:'Grosse Nachfrage für Sammlerstücke'},{name:'Facebook Marketplace',reason:'Lokal & schnell'}];
  } else if (cat.includes('buch')||cat.includes('buecher')) {
    channels = [{name:'ZVAB / AbeBooks',reason:'Spezialisiert auf Bücher & Antiquariat'},{name:'Ricardo.ch',reason:'CH-Marktplatz'},{name:'Facebook Marketplace',reason:'Lokal, kostenlos'}];
  } else if (cat.includes('sport')) {
    channels = [{name:'Ricardo.ch',reason:'Gut für Sportartikel in CH'},{name:'Facebook Marketplace',reason:'Lokal & schnell'},{name:'eBay.de',reason:'Grosse Reichweite'}];
  } else if (cat.includes('musik')) {
    channels = [{name:'Ricardo.ch',reason:'CH-Marktplatz für Instrumente'},{name:'eBay.de',reason:'Grosse Musikbörse'},{name:'Facebook Marketplace',reason:'Lokal & direkt'}];
  } else {
    channels = [{name:'Ricardo.ch',reason:'Grösster Schweizer Marktplatz'},{name:'Tutti.ch',reason:'Kostenlos, lokal'},{name:'eBay.de',reason:'Internationale Reichweite'}];
  }
  return { demandScore, demandLabel, timeToSell, channels };
}

async function generateNote(objectInfo, ebayData, buyPrice, sellPrice, demandScore) {
  const profit = (sellPrice - buyPrice).toFixed(2);
  const roi = buyPrice > 0 ? (((sellPrice-buyPrice)/buyPrice)*100).toFixed(0) : 0;
  const prompt = `Du bist ein Reselling-Experte. Analysiere diesen Deal in 1-2 Saetzen auf Deutsch.\nObjekt: ${objectInfo.objectName} (${objectInfo.category}), Zustand: ${objectInfo.condition}\nKaufpreis: CHF ${buyPrice}, Zielpreis: CHF ${sellPrice}, Gewinn: CHF ${profit} (ROI: ${roi}%)\nMarkt-O: CHF ${ebayData?.marketAvg||'unbekannt'}, Nachfrage: ${demandScore}/100\nSei direkt und ehrlich. Keine Floskeln.`;
  const result = await httpsPost('api.openai.com','/v1/chat/completions',
    {'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
    {model:'gpt-4o-mini',max_tokens:120,messages:[{role:'user',content:prompt}]}
  );
  return result.body.choices?.[0]?.message?.content?.trim() || '';
}

async function generateFairnessNote(objectInfo, ebayData, askedPrice) {
  const avg = parseFloat(ebayData?.marketAvg) || 0;
  const ratio = avg > 0 ? (askedPrice/avg).toFixed(2) : null;
  const prompt = `Du bist ein Marktpreis-Experte. Bewerte diesen Preis in 1-2 Saetzen auf Deutsch.\nObjekt: ${objectInfo.objectName}, Zustand: ${objectInfo.condition}\nVerlangter Preis: CHF ${askedPrice}, Markt-O: CHF ${avg||'unbekannt'}, Verhaeltnis: ${ratio?ratio+'x':'unbekannt'}\nSei direkt. Lohnt es sich?`;
  const result = await httpsPost('api.openai.com','/v1/chat/completions',
    {'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
    {model:'gpt-4o-mini',max_tokens:120,messages:[{role:'user',content:prompt}]}
  );
  return result.body.choices?.[0]?.message?.content?.trim() || '';
}


async function estimatePriceWithAI(objectInfo) {
  const lines = [
    "Estimate the resale price on German/Swiss secondhand market.",
    "Item: " + objectInfo.objectName + " (" + objectInfo.category + "), Condition: " + objectInfo.condition,
    "Reply ONLY with valid JSON: {\"priceMin\":\"number\",\"priceMax\":\"number\",\"marketAvg\":\"number\"}"
  ];
  const prompt = lines.join("\n");
  const result = await httpsPost("api.openai.com", "/v1/chat/completions",
    {"Content-Type": "application/json", "Authorization": "Bearer " + process.env.OPENAI_API_KEY},
    {model: "gpt-4o-mini", max_tokens: 80, messages: [{role: "user", content: prompt}]}
  );
  const raw = result.body.choices?.[0]?.message?.content || "{}";
  const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const p = JSON.parse(clean);
    return {priceMin: p.priceMin, priceMax: p.priceMax, marketAvg: p.marketAvg, listingCount: 0, aiEstimate: true};
  } catch(e) { return null; }
}



async function getVintedListings(searchQuery) {
  try {
    const encoded = encodeURIComponent(searchQuery);
    const result = await httpsGet('www.vinted.de',
      `/api/v2/catalog/items?search_text=${encoded}&per_page=20&order=relevance`,
      {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'application/json',
        'Accept-Language': 'de-DE,de;q=0.9',
      }
    );
    if (result.status !== 200 || !result.body?.items) return [];
    return result.body.items
      .filter(i => parseFloat(i.price_numeric) > 0)
      .slice(0, 3)
      .map(i => ({
        title: (i.title || '').substring(0, 60),
        price: parseFloat(i.price_numeric).toFixed(2),
        currency: i.currency || 'EUR',
        url: `https://www.vinted.de/items/${i.id}`,
        condition: i.status || null,
        source: 'Vinted'
      }));
  } catch(e) { console.error('Vinted error:', e.message); return []; }
}

async function getPriceChartingListings(searchQuery) {
  if (!process.env.PRICECHARTING_API_KEY) return [];
  try {
    const encoded = encodeURIComponent(searchQuery);
    const result = await httpsGet('www.pricecharting.com',
      `/api/product?status=200&q=${encoded}&apikey=${process.env.PRICECHARTING_API_KEY}`,
      { 'Accept': 'application/json' }
    );
    if (result.status !== 200 || !result.body?.products) return [];
    return result.body.products.slice(0, 2).map(p => ({
      title: (p['product-name'] || '').substring(0, 60),
      price: ((p['loose-price'] || 0) / 100 * 0.92).toFixed(2), // USD → EUR approx
      currency: 'EUR',
      url: p.id ? `https://www.pricecharting.com/game/${p.id}` : null,
      source: 'PriceCharting'
    })).filter(p => parseFloat(p.price) > 0);
  } catch(e) { console.error('PriceCharting error:', e.message); return []; }
}

async function lookupBarcode(barcode) {
  try {
    const result = await httpsGet('api.upcitemdb.com', `/prod/trial/lookup?upc=${barcode}`,
      { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    );
    if (result.status !== 200 || !result.body?.items?.length) return null;
    const item = result.body.items[0];
    const rawTitle = item.title || 'Artikel';
    const ebayQuery = ((item.brand ? item.brand + ' ' : '') + rawTitle).substring(0, 60);
    return {
      objectName: rawTitle,
      category: mapUPCCategory(item.category),
      brand: item.brand || null,
      condition: 'Sehr gut',
      ebaySearchQuery: ebayQuery,
      confidence: 99,
      upcRetailPriceMin: item.lowest_recorded_price || null,
      upcRetailPriceMax: item.highest_recorded_price || null,
    };
  } catch(e) { console.error('Barcode lookup error:', e.message); return null; }
}

function mapUPCCategory(cat) {
  if (!cat) return 'Sonstiges';
  const c = cat.toLowerCase();
  if (c.includes('electron') || c.includes('computer') || c.includes('phone') || c.includes('camera')) return 'Elektronik';
  if (c.includes('cloth') || c.includes('apparel') || c.includes('fashion') || c.includes('shirt') || c.includes('jacket')) return 'Kleidung';
  if (c.includes('shoe') || c.includes('footwear') || c.includes('sneaker')) return 'Schuhe';
  if (c.includes('toy') || c.includes('game') || c.includes('puzzle') || c.includes('lego')) return 'Spielzeug';
  if (c.includes('book') || c.includes('media') || c.includes('magazine')) return 'Buecher';
  if (c.includes('sport') || c.includes('outdoor') || c.includes('fitness') || c.includes('bike')) return 'Sport';
  if (c.includes('music') || c.includes('instrument') || c.includes('vinyl')) return 'Musik';
  if (c.includes('jewelry') || c.includes('jewellery') || c.includes('ring') || c.includes('necklace')) return 'Schmuck';
  if (c.includes('watch') || c.includes('clock')) return 'Uhren';
  if (c.includes('home') || c.includes('kitchen') || c.includes('furniture') || c.includes('garden')) return 'Haushalt';
  return 'Sonstiges';
}

async function getKleinanzeigenListings(searchQuery) {
  try {
    const encoded = encodeURIComponent(searchQuery);
    // Kleinanzeigen search page returns HTML – extract price data via regex
    const result = await withTimeout(
      httpsGet('www.kleinanzeigen.de',
        `/s-suchanfrage.html?keywords=${encoded}&categoryId=-1&locationId=0&radius=0&sortingField=RELEVANCE&pageNum=0`,
        {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'de-DE,de;q=0.9',
        }
      ), 3000, null
    );
    if (!result || result.status !== 200) return [];
    const html = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);

    // Extract listing data embedded as JSON in page or from article tags
    const listings = [];
    // Match price patterns: e.g. "10 €" or "10,50 €"
    const articleRe = /data-href="([^"]+)"[^>]*>[\s\S]*?class="[^"]*text-module-begin[^"]*"[^>]*>([^<]{3,80})<[\s\S]*?(\d[\d\.,]{0,8})\s*€/g;
    let m;
    while ((m = articleRe.exec(html)) !== null && listings.length < 3) {
      const url = 'https://www.kleinanzeigen.de' + m[1];
      const title = m[2].trim();
      const price = parseFloat(m[3].replace(',','.'));
      if (price > 0) listings.push({ title: title.substring(0,60), price: price.toFixed(2), currency: 'EUR', url, source: 'Kleinanzeigen' });
    }
    // Fallback: simple price + title extraction
    if (!listings.length) {
      const priceRe = /class="[^"]*aditem-main[^"]*"[\s\S]*?<strong[^>]*>([\d\.,]+)\s*€<\/strong>[\s\S]*?class="[^"]*ellipsis[^"]*"[^>]*>([^<]{3,80})</g;
      while ((m = priceRe.exec(html)) !== null && listings.length < 3) {
        const price = parseFloat(m[1].replace(',','.'));
        if (price > 0) listings.push({ title: m[2].trim().substring(0,60), price: price.toFixed(2), currency: 'EUR', url: 'https://www.kleinanzeigen.de/s-' + encoded, source: 'Kleinanzeigen' });
      }
    }
    return listings;
  } catch(e) { console.error('Kleinanzeigen error:', e.message); return []; }
}

async function getRicardoListings(searchQuery) {
  try {
    const encoded = encodeURIComponent(searchQuery);
    // Ricardo search page – extract embedded JSON (next.js __NEXT_DATA__)
    const result = await withTimeout(
      httpsGet('www.ricardo.ch',
        `/de/s/${encoded}/`,
        {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'de-CH,de;q=0.9',
        }
      ), 3000, null
    );
    if (!result || result.status !== 200) return [];
    const html = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);

    // Extract __NEXT_DATA__ JSON embedded in page
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) return [];
    const nextData = JSON.parse(nextDataMatch[1]);

    // Navigate to listings in Ricardo's Next.js data structure
    const results = nextData?.props?.pageProps?.searchResult?.results ||
                    nextData?.props?.pageProps?.listings ||
                    nextData?.props?.pageProps?.data?.listings || [];

    return results.slice(0, 3).map(item => {
      const price = item.buyNowPrice || item.startPrice || item.currentBidPrice;
      return {
        title: (item.title || '').substring(0, 60),
        price: price ? parseFloat(price).toFixed(2) : null,
        currency: 'CHF',
        url: item.slug ? 'https://www.ricardo.ch/de/a/' + item.slug : 'https://www.ricardo.ch/de/s/' + encoded,
        source: 'Ricardo.ch'
      };
    }).filter(l => l.price && parseFloat(l.price) > 0);
  } catch(e) { console.error('Ricardo error:', e.message); return []; }
}

async function getKeepaRetailPrice(searchQuery) {
  if (!process.env.KEEPA_API_KEY) return null;
  try {
    const encoded = encodeURIComponent(searchQuery);
    const result = await withTimeout(
      httpsGet('api.keepa.com',
        `/search?key=${process.env.KEEPA_API_KEY}&domain=3&type=product&term=${encoded}&page=0`,
        { 'Accept': 'application/json' }
      ), 3000, null
    );
    if (!result || result.status !== 200 || !result.body?.products?.length) return null;
    const product = result.body.products[0];
    // Keepa prices are in 1/100 EUR (Keepa-cents). -1 = not available.
    const priceKeepa = product.stats?.current?.[0];
    if (!priceKeepa || priceKeepa === -1) return null;
    const priceEUR = (priceKeepa / 100).toFixed(2);
    return {
      retailPrice: priceEUR,
      retailConfidence: 'high',
      retailSource: 'Amazon.de'
    };
  } catch(e) { console.error('Keepa error:', e.message); return null; }
}

async function estimateRetailPrice(objectInfo) {
  const name = objectInfo.objectName + (objectInfo.brand ? ', ' + objectInfo.brand : '');
  const prompt = "You are a product pricing expert. What is the typical new retail price for this item in Europe (EUR/CHF)?\nItem: " + name + "\nReply ONLY with valid JSON: {\"retailPrice\":number_or_null,\"confidence\":\"high|medium|low\"}\nIf the item is too generic or unknown, set retailPrice to null.";
  const result = await httpsPost("api.openai.com", "/v1/chat/completions",
    {"Content-Type": "application/json", "Authorization": "Bearer " + process.env.OPENAI_API_KEY},
    {model: "gpt-4o-mini", max_tokens: 60, messages: [{role: "user", content: prompt}]}
  );
  const raw = result.body.choices?.[0]?.message?.content || "{}";
  const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const p = JSON.parse(clean);
    if (p.retailPrice && parseFloat(p.retailPrice) > 0) {
      return { retailPrice: parseFloat(p.retailPrice).toFixed(2), retailConfidence: p.confidence || "medium" };
    }
    return null;
  } catch(e) { return null; }
}


function buildObjectInfoFromUser(userBrand, userModel, userSize, userCategory) {
  const category = userCategory || 'Sonstiges';
  const parts = [userBrand, userModel].filter(Boolean);
  const objectName = parts.join(' ') || userBrand || 'Artikel';
  // Build targeted eBay query: brand + model + size for clothing
  const queryParts = [...parts];
  if (userSize && ['Kleidung','Schuhe','Sport'].includes(category)) queryParts.push(userSize);
  const ebaySearchQuery = queryParts.join(' ').substring(0, 50);
  return {
    objectName,
    category,
    brand: userBrand,
    condition: 'Gut',
    ebaySearchQuery,
    confidence: 90,
    model: userModel || null
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { image, barcode=null, mode='resell', buyPrice=0, sellPrice=0, askedPrice=0, condition=null, userBrand=null, userModel=null, userYear=null, userSize=null, userCategory=null } = req.body || {};
  if (!image && !barcode) return res.status(400).json({ error: 'Kein Bild oder Barcode übermittelt' });

  try {
    // Priority: barcode > brand+vision > vision-only
    let objectInfo;
    if (barcode) {
      const barcodeInfo = await lookupBarcode(barcode);
      if (barcodeInfo) {
        objectInfo = barcodeInfo;
      } else if (image) {
        // Barcode lookup failed → fallback to vision
        console.log('Barcode not found in UPC DB, falling back to Vision');
        objectInfo = await identifyObject(image);
      } else {
        return res.status(400).json({ error: 'Barcode nicht erkannt und kein Foto verfügbar' });
      }
    } else if (userBrand && image) {
      // Brand provided: combine brand knowledge + vision
      objectInfo = await identifyWithBrand(image, userBrand, userModel, userSize, userCategory);
    } else {
      // Standard vision identification
      objectInfo = await identifyObject(image);
    }
    if (condition) objectInfo.condition = condition;
    if (userBrand) objectInfo.brand = userBrand;
    if (userModel) objectInfo.model = userModel;

    let ebayData = null;
    let retailData = null;
    // searchQuery declared here so it's accessible outside the inner try block
    const searchQuery = objectInfo.ebaySearchQuery ||
      [userBrand, userModel, userYear].filter(Boolean).join(' ') ||
      objectInfo.objectName;
    try {
      // Retail price: Keepa (real Amazon.de price) → fallback GPT estimate
      const retailPromise = (async () => {
        const keepa = await getKeepaRetailPrice(searchQuery);
        if (keepa) return keepa;
        return estimateRetailPrice(objectInfo);
      })();

      const [ebayResult, retailResult, vintedResult, pcResult, kleinResult, ricardoResult] = await Promise.allSettled([
        getEbayPrices(searchQuery),
        retailPromise,
        withTimeout(getVintedListings(searchQuery), 2000, []),
        withTimeout(getPriceChartingListings(searchQuery), 2000, []),
        withTimeout(getKleinanzeigenListings(searchQuery), 3000, []),
        withTimeout(getRicardoListings(searchQuery), 3000, [])
      ]);
      if (ebayResult.status === 'fulfilled') ebayData = ebayResult.value;
      if (retailResult.status === 'fulfilled') retailData = retailResult.value;
      // If UPC lookup returned retail price range, use as fallback
      if (!retailData && objectInfo.upcRetailPriceMin) {
        const mid = ((objectInfo.upcRetailPriceMin + objectInfo.upcRetailPriceMax) / 2);
        retailData = { retailPrice: mid.toFixed(2), retailConfidence: 'high' };
      }
      const vintedListings   = vintedResult.status   === 'fulfilled' ? vintedResult.value   : [];
      const pcListings       = pcResult.status       === 'fulfilled' ? pcResult.value       : [];
      const kleinListings    = kleinResult.status    === 'fulfilled' ? kleinResult.value    : [];
      const ricardoListings  = ricardoResult.status  === 'fulfilled' ? ricardoResult.value  : [];

      // Merge all sources into topListings
      if (ebayData) {
        const extra = [...vintedListings, ...pcListings, ...kleinListings, ...ricardoListings];
        ebayData.topListings = [...(ebayData.topListings || []).map(l => ({...l, source:'eBay'})), ...extra];
      } else if (kleinListings.length || ricardoListings.length || vintedListings.length) {
        // No eBay data: build synthetic ebayData from other sources for display
        const allExtra = [...vintedListings, ...kleinListings, ...ricardoListings, ...pcListings];
        const prices = allExtra.map(l => parseFloat(l.price)).filter(p => p > 0);
        if (prices.length) {
          const avg = (prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(2);
          ebayData = { priceMin: Math.min(...prices).toFixed(2), priceMax: Math.max(...prices).toFixed(2),
            marketAvg: avg, listingCount: prices.length, aiEstimate: false, topListings: allExtra };
        }
      }
    } catch(e) { console.error('Data fetch error:', e.message); }
    if (!ebayData) {
      try { ebayData = await estimatePriceWithAI(objectInfo); } catch(e2) { console.error('AI price fallback:', e2.message); }
    }

    let aiNote = '';

    if (mode === 'fairness') {
      try { aiNote = await generateFairnessNote(objectInfo, ebayData, askedPrice); } catch(e) { console.error('Fairness note error:', e.message); }
      const ebaySearchUrl = buildEbaySearchUrl(searchQuery);
      const amazonSearchUrl = buildAmazonSearchUrl(searchQuery);
      return res.status(200).json({
        objectName: objectInfo.objectName, category: objectInfo.category,
        brand: objectInfo.brand, condition: objectInfo.condition,
        priceMin: ebayData?.priceMin||null, priceMax: ebayData?.priceMax||null,
        marketAvg: ebayData?.marketAvg||null, aiNote,
        retailPrice: retailData?.retailPrice||null, retailConfidence: retailData?.retailConfidence||null,
        retailSource: retailData?.retailSource||null,
        topListings: ebayData?.topListings||[],
        ebaySearchUrl, amazonSearchUrl,
      });
    }

    const { demandScore, demandLabel, timeToSell, channels } = analyzeDemandAndChannels(objectInfo, ebayData);
    try { aiNote = await generateNote(objectInfo, ebayData, buyPrice, sellPrice, demandScore); } catch(e) { console.error('Note error:', e.message); }

    const ebaySearchUrl = buildEbaySearchUrl(searchQuery);
    const amazonSearchUrl = buildAmazonSearchUrl(searchQuery);
    return res.status(200).json({
      objectName: objectInfo.objectName, category: objectInfo.category,
      brand: objectInfo.brand, condition: objectInfo.condition,
      priceMin: ebayData?.priceMin||null, priceMax: ebayData?.priceMax||null,
      marketAvg: ebayData?.marketAvg||null,
      demandScore, demandLabel, timeToSell, channels, aiNote,
      retailPrice: retailData?.retailPrice||null, retailConfidence: retailData?.retailConfidence||null,
      retailSource: retailData?.retailSource||null,
      topListings: ebayData?.topListings||[],
      ebaySearchUrl, amazonSearchUrl,
    });

  } catch(err) {
    console.error('Analysis error:', err);
    return res.status(500).json({ error: err.message || 'Analyse fehlgeschlagen' });
  }
};

// This line intentionally left blank - file integrity check
