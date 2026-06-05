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

async function getEbayPrices(searchQuery, conditionFilter = null) {
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

  const condParam = conditionFilter && conditionFilter !== 'UNSPECIFIED' ? `&filter=conditions:{${conditionFilter}}` : '';
  const searchRes = await httpsGet('api.ebay.com',
    `/buy/browse/v1/item_summary/search?q=${encoded}&limit=50&sort=price${condParam}`,
    headers);

  const items = searchRes.body?.itemSummaries || [];
  if (items.length === 0) return null;

  let prices = items.map(i=>parseFloat(i.price?.value||0)).filter(p=>p>0).sort((a,b)=>a-b);

  // Remove outliers: filter out items below 15% of median (likely accessories)
  const median = prices[Math.floor(prices.length/2)];
  prices = prices.filter(p => p >= median * 0.15);
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
      url: i.itemWebUrl || null,
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
  const { image, mode='resell', buyPrice=0, sellPrice=0, askedPrice=0, condition=null, userBrand=null, userModel=null, userYear=null, userSize=null, userCategory=null } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Kein Bild übermittelt' });

  try {
    // Skip expensive GPT-Vision call if user provided brand info
    let objectInfo;
    if (userBrand) {
      objectInfo = buildObjectInfoFromUser(userBrand, userModel, userSize, userCategory);
    } else {
      objectInfo = await identifyObject(image);
    }
    if (condition) objectInfo.condition = condition;
    if (userBrand) objectInfo.brand = userBrand;
    if (userModel) objectInfo.model = userModel;

    let ebayData = null;
    let retailData = null;
    try {
      const searchQuery = (() => {
        // User-provided info always wins over AI detection
        if (userBrand || userModel) {
          const parts = [];
          if (userBrand) parts.push(userBrand);
          if (userModel) parts.push(userModel);
          if (userYear) parts.push(userYear.toString());
          // Size only for clothing (not useful for electronics etc.)
          const clothingSizes = ['xxs','xs','s','m','l','xl','xxl'];
          if (userSize && clothingSizes.includes(userSize.toLowerCase().trim())) {
            parts.push(userSize);
          }
          return parts.join(' ');
        }
        // Fall back to AI-detected query with brand prepended
        let q = objectInfo.ebaySearchQuery || objectInfo.objectName;
        if (objectInfo.brand && objectInfo.brand !== 'null' && objectInfo.brand !== null &&
            !q.toLowerCase().includes(objectInfo.brand.toLowerCase())) {
          q = objectInfo.brand + ' ' + q;
        }
        return q;
      })();
      const condFilterMap = {'Neu':'NEW','Sehr gut':'USED','Gut':'USED','Akzeptabel':'USED','Beschaedigt':'UNSPECIFIED'};
      const condFilter = condFilterMap[objectInfo.condition] || null;

      const [ebayResult, retailResult, vintedResult, pcResult] = await Promise.allSettled([
        objectInfo.ebaySearchQuery ? getEbayPrices(searchQuery, condFilter) : Promise.resolve(null),
        estimateRetailPrice(objectInfo),
        withTimeout(getVintedListings(searchQuery), 3000, []),
        withTimeout(getPriceChartingListings(searchQuery), 3000, [])
      ]);
      if (ebayResult.status === 'fulfilled') ebayData = ebayResult.value;
      if (retailResult.status === 'fulfilled') retailData = retailResult.value;
      const vintedListings = vintedResult.status === 'fulfilled' ? vintedResult.value : [];
      const pcListings = pcResult.status === 'fulfilled' ? pcResult.value : [];

      // Merge extra listings into ebayData.topListings
      if (ebayData) {
        const extra = [...vintedListings, ...pcListings];
        ebayData.topListings = [...(ebayData.topListings || []).map(l => ({...l, source:'eBay'})), ...extra];
      }
    } catch(e) { console.error('Data fetch error:', e.message); }
    if (!ebayData) {
      try { ebayData = await estimatePriceWithAI(objectInfo); } catch(e2) { console.error('AI price fallback:', e2.message); }
    }

    let aiNote = '';

    if (mode === 'fairness') {
      try { aiNote = await generateFairnessNote(objectInfo, ebayData, askedPrice); } catch(e) { console.error('Fairness note error:', e.message); }
      return res.status(200).json({
        objectName: objectInfo.objectName, category: objectInfo.category,
        brand: objectInfo.brand, condition: objectInfo.condition,
        priceMin: ebayData?.priceMin||null, priceMax: ebayData?.priceMax||null,
        marketAvg: ebayData?.marketAvg||null, aiNote,
        retailPrice: retailData?.retailPrice||null, retailConfidence: retailData?.retailConfidence||null,
        topListings: ebayData?.topListings||[],
      });
    }

    const { demandScore, demandLabel, timeToSell, channels } = analyzeDemandAndChannels(objectInfo, ebayData);
    try { aiNote = await generateNote(objectInfo, ebayData, buyPrice, sellPrice, demandScore); } catch(e) { console.error('Note error:', e.message); }

    return res.status(200).json({
      objectName: objectInfo.objectName, category: objectInfo.category,
      brand: objectInfo.brand, condition: objectInfo.condition,
      priceMin: ebayData?.priceMin||null, priceMax: ebayData?.priceMax||null,
      marketAvg: ebayData?.marketAvg||null,
      demandScore, demandLabel, timeToSell, channels, aiNote,
      retailPrice: retailData?.retailPrice||null, retailConfidence: retailData?.retailConfidence||null,
      topListings: ebayData?.topListings||[],
    });

  } catch(err) {
    console.error('Analysis error:', err);
    return res.status(500).json({ error: err.message || 'Analyse fehlgeschlagen' });
  }
};

// This line intentionally left blank - file integrity check
