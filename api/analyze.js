// Comparadoo – Serverless API Function (Vercel)
const https = require('https');
const crypto = require('crypto');

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

// ── Kategorie → eBay Category ID Mapping ────────────────────────────
const CATEGORY_EBAY_MAP = {
  'Elektronik': {
    subTypes: {
      'smartphone': '9355', 'handy': '9355', 'iphone': '9355', 'samsung': '9355',
      'tablet': '171485', 'ipad': '171485',
      'laptop': '58058', 'notebook': '58058', 'macbook': '58058',
      'monitor': '80053',
      'kamera': '625', 'camera': '625', 'objektiv': '625', 'drohne': '625', 'actionkamera': '625',
      'gaming-konsole': '1249', 'konsole': '1249', 'playstation': '1249', 'xbox': '1249', 'nintendo': '1249',
      'tv': '32852', 'fernseher': '32852', 'audio': '32852', 'kopfhörer': '32852', 'lautsprecher': '32852',
      'smartwatch': '9355', 'e-reader': '171485', 'kindle': '171485',
    },
    default: '58058'
  },
  'Spielzeug': {
    subTypes: {
      'lego': '19006',      // LEGO Sets on eBay.de
      'playmobil': '220',
      'barbie': '220',
    },
    default: '220'
  },
  'Uhren & Schmuck': {
    subTypes: { 'uhr': '14324', 'watch': '14324', 'schmuck': '10968', 'ring': '10968', 'kette': '10968', 'armband': '10968' },
    default: '14324'
  },
  'Kleidung & Accessoires': {
    subTypes: {
      'schuh': '63889', 'sneaker': '63889', 'boot': '63889',
      'tasche': '169291', 'handtasche': '169291', 'rucksack': '169291',
      'schmuck': '10968', 'sonnenbrille': '11450',
    },
    default: '11450'
  },
  'Sport & Outdoor':      { default: '888' },
  'Musik':                { default: '619' },
  'Möbel & Wohnen': {
    subTypes: {
      // Antique routing → Antiquitäten & Kunst category
      'antik': '20081', 'antiquität': '20081', 'biedermeier': '20081',
      'jugendstil': '20081', 'art deco': '20081', 'jugendstil': '20081',
      'gründerzeit': '20081', 'historismus': '20081', 'klassizismus': '20081',
      'barock': '20081', 'empire': '20081', 'victorian': '20081',
      // Modern furniture subcategories
      'sofa': '175757', 'sessel': '175757', 'stuhl': '175757',
      'schrank': '175753', 'kommode': '175753', 'sideboard': '175753',
      'tisch': '175754', 'schreibtisch': '175754',
      'bett': '175758', 'bettgestell': '175758',
      'regal': '11700', 'vitrine': '175753',
    },
    default: '11700'
  },
  'Antiquitäten & Kunst': {
    subTypes: {
      'möbel': '20097', 'schrank': '20097', 'kommode': '20097',
      'stuhl': '20097', 'tisch': '20097', 'sekretär': '20097',
      'gemälde': '11231', 'ölgemälde': '11231', 'aquarell': '11231',
      'skulptur': '737', 'figur': '737', 'plastik': '737',
      'keramik': '870', 'porzellan': '870', 'fayence': '870',
      'silber': '550', 'gold': '550', 'besteck': '550',
      'glas': '870', 'kristall': '870',
      'uhr': '14324', 'pendeluhr': '14324',
      'teppich': '37911', 'orientteppich': '37911',
    },
    default: '20081'
  },
  'Sammler': {
    subTypes: {
      'pokemon': '183454', 'magic': '19107', 'mtg': '19107',
      'yu-gi-oh': '183452', 'yugioh': '183452',
      'sammelkarte': '183454', 'karte': '183454', 'trading card': '183454',
      'münze': '253', 'coin': '253', 'briefmarke': '260',
    },
    default: '183454'  // Sammelkarten (trading cards) as default for Sammler
  },
  'Haushalt & Küche':     { default: '20625' },
};

function getCategoryEbayId(category, subType, stylePeriod, isAntique) {
  const map = CATEGORY_EBAY_MAP[category];
  if (!map) return null;
  if (map.subTypes) {
    // For Möbel: antique style period overrides to Antiquitäten category
    if (isAntique && (category === 'Möbel & Wohnen') && CATEGORY_EBAY_MAP['Möbel & Wohnen'].subTypes['antik']) {
      return CATEGORY_EBAY_MAP['Möbel & Wohnen'].subTypes['antik'];
    }
    const searchText = ((subType || '') + ' ' + (stylePeriod || '')).toLowerCase();
    for (const [key, id] of Object.entries(map.subTypes)) {
      if (searchText.includes(key)) return id;
    }
  }
  return map.default || null;
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
  const prompt = `You are identifying a secondhand item for a resell price check app.

STEP 1 — Read ALL visible text in the image: brand logos, model names, product codes, serial numbers, labels, tags, engravings, maker stamps/marks. This is critical for accuracy.

STEP 2 — Identify the item as precisely as possible using both visual analysis and the text you read.

STEP 3 — For furniture and antiques: carefully examine construction style, joinery, hardware, patina, decorative elements, and any visible stamps or labels to determine style period and approximate age.

Respond ONLY with valid JSON (no markdown):
{
  "objectName": "Full product name in German (e.g. Sony DualSense PS5 Controller Weiss / Biedermeier Nussbaum Kommode)",
  "brand": "Manufacturer/maker brand or null",
  "model": "Exact model/product line or null",
  "color": "Color or null",
  "category": "Elektronik|Spielzeug|Uhren & Schmuck|Kleidung & Accessoires|Sport & Outdoor|Musik|Möbel & Wohnen|Antiquitäten & Kunst|Sammler|Haushalt & Küche",
  "subType": "Specific sub-type (e.g. Smartphone, Laptop, Schrank, Kommode, Sekretär, Stuhl, Tisch, Vitrine, Gemälde, Skulptur) or null",
  "condition": "Neu|Sehr gut|Gut|Akzeptabel|Beschaedigt",
  "stylePeriod": "For furniture/art only: Biedermeier|Gründerzeit|Jugendstil|Art Deco|Barock|Rokoko|Empire|Historismus|Klassizismus|Victorian|Mid-Century Modern|Bauhaus|Contemporary — or null",
  "estimatedEra": "For furniture/art only: estimated decade like ~1850-1870 or ~1920er — or null",
  "material": "For furniture/art only: primary material like Nussbaum|Eiche|Mahagoni|Kirsche|Buche|Palisander|Messing|Marmor — or null",
  "makerMark": "Any visible signature, stamp, label, or maker mark — exact text if readable, 'vorhanden' if visible but unreadable, or null",
  "isAntique": true if estimated age > 80 years or clear antique style, false otherwise,
  "ebaySearchQuery": "Specific search query 4-8 words. For antiques include style+type+material (e.g. Biedermeier Kommode Nussbaum antik)",
  "ebaySearchQueryBroad": "Broad fallback 2-4 words (e.g. Biedermeier Kommode)",
  "contextInfo": "2-3 sentences in German about what this object is, its history/origin, and why it's interesting for buyers/collectors. For electronics: notable features. For antiques: style period, typical origin, collector appeal. For cards: set/rarity context. Max 60 words.",
  "confidence": 85
}
confidence = integer 0-100. For antiques: 90+ only if style/period clearly identifiable. Lower if ambiguous.`;

  const result = await httpsPost(
    'api.openai.com', '/v1/chat/completions',
    { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model: 'gpt-4o', max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'high' } },
          { type: 'text', text: prompt }
        ]
      }]
    }
  );
  if (result.status !== 200) throw new Error('OpenAI Fehler: ' + JSON.stringify(result.body));
  const content = result.body.choices?.[0]?.message?.content || '{}';
  const clean = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  return JSON.parse(clean);
}

async function identifyWithBrand(base64Image, userBrand, userModel, userSize, userCategory, userRef) {
  // Build confirmed facts — brand and model are hard facts, category is a hint only
  const confirmedFacts = [
    userBrand    ? `Brand: ${userBrand} [CONFIRMED]`          : null,
    userModel    ? `Model: ${userModel} [CONFIRMED]`           : null,
    userSize     ? `Size/Storage: ${userSize} [CONFIRMED]`     : null,
    userCategory ? `User category hint: ${userCategory} (use as guidance, but choose the best category for accurate pricing)` : null,
    userRef      ? `Reference/Serial: ${userRef} [CONFIRMED]`  : null,
  ].filter(Boolean).join('\n');

  // Only ask GPT to fill in what the user didn't provide
  const missingFields = [
    !userBrand    ? '- Brand (read from photo, labels, logos, maker stamps)' : null,
    !userModel    ? '- Exact model/product line (read from labels, text visible in image)' : null,
    '- Exact color / colorway',
    '- Condition based on visual inspection of the photo',
    '- Product category (IMPORTANT: sport/smart watches like Garmin, Suunto, Polar, Fitbit → Elektronik, NOT Uhren & Schmuck)',
    !userRef      ? '- Reference number / serial number if visible' : null,
    '- For furniture/art: stylePeriod (Biedermeier/Jugendstil/Art Deco/etc.), estimatedEra (~decade), material, makerMark, isAntique',
  ].filter(Boolean).join('\n');

  const knownBrand = userBrand || '[brand from photo]';
  const knownModel = userModel || '[model from photo]';
  const exampleQuery = `${knownBrand} ${knownModel}`.substring(0, 40);

  const prompt = `You are identifying a secondhand item for resale price estimation. The user has provided facts — treat CONFIRMED items as 100% correct:

${confirmedFacts}

STEP 1 — Read ALL visible text in the photo: labels, model numbers, product codes, logos, serial numbers, hallmarks, tags.

STEP 2 — Using the confirmed facts + visible text, identify what is missing:
${missingFields}

STEP 3 — Build eBay search queries that will find the EXACT item (not accessories or similar models):
- Specific (ebaySearchQuery): ${userBrand ? 'confirmed brand' : 'detected brand'}${userModel ? ' + confirmed model' : ' + detected model'}, then add color/variant. Max 8 words. (e.g. "${exampleQuery} black")
- Broad (ebaySearchQueryBroad): brand + product type only, 2-4 words.

CRITICAL: If model is confirmed, the ebaySearchQuery MUST contain that exact model name.

Reply ONLY with valid JSON (no markdown):
{
  "objectName": "Full product name in German (use confirmed brand + model)",
  "brand": "${userBrand || 'detected brand from photo'}",
  "model": ${userModel ? `"${userModel}"` : '"detected model from photo"'},
  "color": "detected color",
  "category": "Elektronik|Spielzeug|Uhren & Schmuck|Kleidung & Accessoires|Sport & Outdoor|Musik|Möbel & Wohnen|Antiquitäten & Kunst|Sammler|Haushalt & Küche",
  "subType": "specific sub-type (e.g. Smartphone, Smartwatch, Laptop, Uhr, Schuh, Kommode, Sekretär, Stuhl) or null",
  "condition": "Neu|Sehr gut|Gut|Akzeptabel|Beschaedigt",
  "stylePeriod": "For furniture/art: Biedermeier|Gründerzeit|Jugendstil|Art Deco|Barock|Empire|Historismus|Klassizismus|Victorian|Mid-Century Modern — or null",
  "estimatedEra": "For furniture/art: ~1850-1870 or null",
  "material": "For furniture/art: Nussbaum|Eiche|Mahagoni|Kirsche|Buche|Palisander|Marmor etc. — or null",
  "makerMark": "Visible signature, stamp or maker mark — exact text or 'vorhanden' or null",
  "isAntique": true if estimated age > 80 years, false otherwise,
  "ebaySearchQuery": "For antiques include style+type+material (e.g. Biedermeier Kommode Nussbaum). For others: brand+model.",
  "ebaySearchQueryBroad": "style + furniture type or brand + product type, 2-4 words",
  "contextInfo": "2-3 sentences in German about what this object is, its history/origin, and why it's interesting for buyers/collectors. For electronics: notable features. For antiques: style period, typical origin, collector appeal. For cards: set/rarity context. Max 60 words.",
  "confidence": 90
}
confidence = integer 0-100 (NOT 0-1). 90 = confident. Use lower values if image is unclear or item ambiguous.`;

  const result = await httpsPost(
    'api.openai.com', '/v1/chat/completions',
    { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model: 'gpt-4o', max_tokens: 450,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'high' } }
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

async function getEbaySoldPrices(searchQuery, categoryId = null) {
  try {
    const encoded = encodeURIComponent(searchQuery);
    const catParam = categoryId ? `&categoryId=${categoryId}` : '';
    const appId = process.env.EBAY_CLIENT_ID;

    const result = await httpsGet(
      'svcs.ebay.com',
      `/services/search/FindingService/v1?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0&SECURITY-APPNAME=${appId}&RESPONSE-DATA-FORMAT=JSON&keywords=${encoded}&itemFilter%280%29.name=SoldItemsOnly&itemFilter%280%29.value=true${catParam}&paginationInput.entriesPerPage=50`,
      { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    );

    const items = result.body?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
    if (items.length === 0) return null;

    let prices = items
      .map(i => parseFloat(i.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.__value__ || 0))
      .filter(p => p > 0)
      .sort((a, b) => a - b);
    if (prices.length === 0) return null;

    // For sold listings: use IQR-based outlier removal instead of cluster detection.
    // Cluster detection (picking upper cluster) works for active listings to remove cheap
    // accessories, but for sold listings it wrongly selects expensive bundles.
    const q1 = prices[Math.floor(prices.length * 0.25)];
    const q3 = prices[Math.floor(prices.length * 0.75)];
    const iqr = q3 - q1;
    const filtered = prices.filter(p => p >= q1 - 1.5 * iqr && p <= q3 + 1.5 * iqr);
    const work = filtered.length >= 3 ? filtered : prices;

    // Use median (not mean) — robust against remaining outliers
    const median = work[Math.floor(work.length / 2)];
    const low  = work[Math.floor(work.length * 0.10)];
    const high = work[Math.floor(work.length * 0.90)];

    return {
      soldAvg:   parseFloat(median.toFixed(2)),
      soldMin:   parseFloat(low.toFixed(2)),
      soldMax:   parseFloat(high.toFixed(2)),
      soldCount: work.length,
    };
  } catch(e) {
    console.error('eBay Sold Prices error:', e.message);
    return null;
  }
}

async function getEbayPrices(searchQuery, categoryId = null) {
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

  // sort=price removed: it returned 50 cheapest items (accessories/parts), not main product
  // Best Match (default) surfaces most relevant listings for the search query
  const catParam = categoryId ? `&category_ids=${categoryId}` : '';
  const searchRes = await httpsGet('api.ebay.com',
    `/buy/browse/v1/item_summary/search?q=${encoded}&limit=50${catParam}`,
    headers);

  const items = searchRes.body?.itemSummaries || [];
  if (items.length === 0) return null;

  let prices = items.map(i => parseFloat(i.price?.value || 0)).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return null;

  // ── Cluster-detection: catches bimodal distribution (accessories vs. main item) ──
  // Problem: eBay mixes cheap accessories (2-15 EUR) with main product (45-75 EUR)
  // Solution: find the largest relative gap; if significant upper cluster exists, use it
  if (prices.length >= 6) {
    let bestGapRatio = 1;
    let bestGapIdx = 0;
    for (let i = 1; i < prices.length; i++) {
      const ratio = prices[i] / prices[i - 1];
      if (ratio > bestGapRatio) { bestGapRatio = ratio; bestGapIdx = i; }
    }
    const upperCount = prices.length - bestGapIdx;
    // Trigger if: gap ≥ 2×, upper cluster has ≥ 3 items AND ≥ 20% of total results
    if (bestGapRatio >= 2.0 && upperCount >= 3 && upperCount >= prices.length * 0.20) {
      const upper = prices.slice(bestGapIdx);
      // Only take upper cluster if it's internally coherent (max < 5× min)
      if (upper[upper.length - 1] / upper[0] < 5) {
        prices = upper;
      }
    }
  }

  // ── Fallback: p90-anchor + mean filter for remaining outliers ──
  const p90 = prices[Math.floor(prices.length * 0.90)];
  prices = prices.filter(p => p >= p90 * 0.15);
  if (prices.length === 0) return null;
  if (prices.length > 3) {
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const filtered = prices.filter(p => p >= mean * 0.38);
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
  const antiqueCtx = [
    objectInfo.stylePeriod  ? `Stilepoche: ${objectInfo.stylePeriod}` : null,
    objectInfo.estimatedEra ? `Periode: ${objectInfo.estimatedEra}` : null,
    objectInfo.material     ? `Material: ${objectInfo.material}` : null,
    objectInfo.makerMark && objectInfo.makerMark !== 'null' ? `Signatur: ${objectInfo.makerMark}` : null,
  ].filter(Boolean).join(', ');
  const prompt = `Du bist ein Reselling-Experte${antiqueCtx ? ' mit Schwerpunkt Antiquitäten' : ''}. Analysiere diesen Deal in 1-2 Saetzen auf Deutsch.\nObjekt: ${objectInfo.objectName} (${objectInfo.category}), Zustand: ${objectInfo.condition}${antiqueCtx ? '\n' + antiqueCtx : ''}\nKaufpreis: CHF ${buyPrice}, Zielpreis: CHF ${sellPrice}, Gewinn: CHF ${profit} (ROI: ${roi}%)\nMarkt-O: CHF ${ebayData?.marketAvg||'unbekannt'}, Nachfrage: ${demandScore}/100\nSei direkt und ehrlich. Keine Floskeln.`;
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

async function lookupBarcodeOpenFoodFacts(barcode) {
  try {
    const result = await httpsGet('world.openfoodfacts.org',
      `/api/v0/product/${barcode}.json`,
      { 'Accept': 'application/json', 'User-Agent': 'Comparadoo/1.0 (contact@comparadoo.com)' }
    );
    if (result.status !== 200 || result.body?.status !== 1) return null;
    const p = result.body.product;
    const rawTitle = p.product_name || p.product_name_de || p.product_name_en || 'Lebensmittel';
    const brand = p.brands ? p.brands.split(',')[0].trim() : null;
    const ebayQuery = ((brand ? brand + ' ' : '') + rawTitle).substring(0, 60);
    return {
      objectName: rawTitle,
      category: 'Lebensmittel',
      brand,
      condition: 'Neu',
      ebaySearchQuery: ebayQuery,
      confidence: 95,
      upcRetailPriceMin: null,
      upcRetailPriceMax: null,
    };
  } catch(e) { console.error('OpenFoodFacts error:', e.message); return null; }
}

async function lookupBarcode(barcode) {
  // 1. Try UPCItemDB (broad product DB)
  try {
    const result = await httpsGet('api.upcitemdb.com', `/prod/trial/lookup?upc=${barcode}`,
      { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    );
    if (result.status === 200 && result.body?.items?.length) {
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
    }
  } catch(e) { console.error('UPCItemDB error:', e.message); }

  // 2. Fallback: Open Food Facts (free, no key, ideal for food/grocery barcodes)
  console.log('UPCItemDB miss – trying Open Food Facts for barcode:', barcode);
  return await lookupBarcodeOpenFoodFacts(barcode);
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
  const encoded = encodeURIComponent(searchQuery);

  // ── Attempt 1: Ricardo internal search API (faster, JSON native) ──────────
  try {
    const apiResult = await withTimeout(
      httpsGet('www.ricardo.ch',
        `/api/search/v1/articles?query=${encoded}&limit=5&offset=0`,
        {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'application/json',
          'Accept-Language': 'de-CH,de;q=0.9',
          'Referer': 'https://www.ricardo.ch/de/s/' + encoded + '/',
        }
      ), 3000, null
    );
    if (apiResult && apiResult.status === 200 && apiResult.body?.results?.length) {
      console.log(`Ricardo API: ${apiResult.body.results.length} results`);
      return apiResult.body.results.slice(0, 3).map(item => {
        const price = item.buyNowPrice || item.startPrice || item.currentBidPrice || item.price;
        return {
          title: (item.title || item.name || '').substring(0, 60),
          price: price ? parseFloat(price).toFixed(2) : null,
          currency: 'CHF',
          url: item.slug ? 'https://www.ricardo.ch/de/a/' + item.slug : 'https://www.ricardo.ch/de/s/' + encoded,
          source: 'Ricardo.ch'
        };
      }).filter(l => l.price && parseFloat(l.price) > 0);
    }
  } catch(e) { /* Fall through to HTML scraping */ }

  // ── Attempt 2: HTML __NEXT_DATA__ scraping with deep-search ──────────────
  try {
    const result = await withTimeout(
      httpsGet('www.ricardo.ch',
        `/de/s/${encoded}/`,
        {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'de-CH,de;q=0.9',
        }
      ), 4000, null
    );
    if (!result || result.status !== 200) return [];
    const html = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);

    // Extract __NEXT_DATA__
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) { console.log('Ricardo: no NEXT_DATA found'); return []; }

    let nextData;
    try { nextData = JSON.parse(m[1]); } catch(e) { return []; }

    // ── Deep-search: recursively find arrays containing items with price+title
    function deepFindListings(obj, depth = 0) {
      if (depth > 8 || !obj || typeof obj !== 'object') return null;
      if (Array.isArray(obj) && obj.length > 0) {
        const first = obj[0];
        if (first && typeof first === 'object') {
          const keys = Object.keys(first);
          // Item candidate: has a title-like and price-like field
          const hasTitle = keys.some(k => /title|name|bezeichnung/i.test(k));
          const hasPrice = keys.some(k => /price|preis|betrag|buyNow|startPrice/i.test(k));
          if (hasTitle && hasPrice) return obj;
        }
      }
      for (const key of Object.keys(obj)) {
        const found = deepFindListings(obj[key], depth + 1);
        if (found) return found;
      }
      return null;
    }

    // Try known paths first (faster), then deep-search as fallback
    const pageProps = nextData?.props?.pageProps || {};
    const knownPaths = [
      pageProps?.searchResult?.results,
      pageProps?.searchResult?.hits,
      pageProps?.listings,
      pageProps?.data?.listings,
      pageProps?.data?.results,
      pageProps?.initialData?.results,
      pageProps?.dehydratedState?.queries?.[0]?.state?.data?.results,
      pageProps?.dehydratedState?.queries?.[0]?.state?.data?.data?.results,
    ];

    let items = knownPaths.find(p => Array.isArray(p) && p.length > 0);
    if (!items) {
      console.log('Ricardo: known paths failed, trying deep-search...');
      items = deepFindListings(pageProps);
    }
    if (!items || items.length === 0) {
      console.log('Ricardo: no listings found in NEXT_DATA');
      return [];
    }

    console.log(`Ricardo NEXT_DATA: ${items.length} results found`);
    return items.slice(0, 3).map(item => {
      const price = item.buyNowPrice || item.startPrice || item.currentBidPrice ||
                    item.price?.amount || item.price?.value || item.price ||
                    item.preis || item.betrag;
      const title = item.title || item.name || item.bezeichnung || '';
      const slug  = item.slug || item.id || item.articleId;
      return {
        title: String(title).substring(0, 60),
        price: price ? parseFloat(price).toFixed(2) : null,
        currency: 'CHF',
        url: slug ? 'https://www.ricardo.ch/de/a/' + slug : 'https://www.ricardo.ch/de/s/' + encoded,
        source: 'Ricardo.ch'
      };
    }).filter(l => l.price && parseFloat(l.price) > 0);

  } catch(e) {
    console.error('Ricardo scrape error:', e.message);
    return [];
  }
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

async function estimateRetailPrice(objectInfo, searchQuery) {
  const contextLines = [
    searchQuery               ? `Search: ${searchQuery}`                         : null,
    objectInfo.objectName     ? `Product: ${objectInfo.objectName}`              : null,
    objectInfo.brand          ? `Brand: ${objectInfo.brand}`                     : null,
    objectInfo.model          ? `Model: ${objectInfo.model}`                     : null,
    objectInfo.productLine    ? `Line: ${objectInfo.productLine}`                : null,
    objectInfo.category       ? `Category: ${objectInfo.category}`               : null,
  ].filter(Boolean).join('\n');

  const prompt = `You are a European retail pricing expert with precise knowledge of current prices in Germany and Switzerland.
${contextLines}
What is the typical current RETAIL (new) price in EUR for this product?
Be specific and precise: e.g. "Nike Air Force 1 Low White" → 120, "Sony DualSense PS5 Controller" → 75, "iPhone 14 128GB" → 699.
Reply ONLY with valid JSON: {"retailPrice": number_or_null, "confidence": "high|medium|low"}
Set retailPrice to null only if this is a completely unknown or one-of-a-kind item.`;

  const result = await httpsPost("api.openai.com", "/v1/chat/completions",
    {"Content-Type": "application/json", "Authorization": "Bearer " + process.env.OPENAI_API_KEY},
    {model: "gpt-4o-mini", max_tokens: 80, messages: [{role: "user", content: prompt}]}
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


// ── TCGapi.dev – Trading Card Game Prices ───────────────────────────────────
// Covers Pokémon, Magic, Yu-Gi-Oh!, One Piece, Lorcana, Digimon, 89+ games
// Free: 100 req/day (non-commercial). Pro: $49.99/mo (commercial use required)
// Response prices are in USD → approx. CHF conversion applied

function detectTCGGame(query, objectName) {
  const text = ((query || '') + ' ' + (objectName || '')).toLowerCase();
  if (text.match(/pok[eé]mon|pikachu|charizard|mewtwo|eevee|gengar/)) return 'pokemon';
  if (text.match(/magic|mtg|planeswalker|mana|wizard.*coast/)) return 'magic-the-gathering';
  if (text.match(/yu.?gi.?oh|yugioh|duel monster/)) return 'yu-gi-oh';
  if (text.match(/one.?piece/)) return 'one-piece-card-game';
  if (text.match(/lorcana/)) return 'lorcana-tcg';
  if (text.match(/digimon/)) return 'digimon-card-game';
  if (text.match(/dragon.?ball/)) return 'dragon-ball-super-card-game';
  if (text.match(/flesh.?and.?blood|fab/)) return 'flesh-and-blood-tcg';
  // Generic trading card hint: if category is Sammler and text mentions card terms
  if (text.match(/karte|card|booster|sealed|holo|foil|rare/)) return 'pokemon'; // default to pokemon as largest DB
  return null;
}

async function getTCGApiListings(searchQuery, objectName) {
  if (!process.env.TCGAPI_KEY) return [];
  const game = detectTCGGame(searchQuery, objectName);
  if (!game) return [];
  try {
    const encoded = encodeURIComponent(searchQuery);
    const result = await withTimeout(
      httpsGet('api.tcgapi.dev',
        `/v1/search?q=${encoded}&game=${game}&per_page=5`,
        { 'X-API-Key': process.env.TCGAPI_KEY, 'Accept': 'application/json', 'User-Agent': 'Comparadoo/1.0' }
      ), 4000, null
    );
    if (!result || result.status !== 200 || !result.body?.data?.length) return [];

    // USD → CHF approx (1 USD ≈ 0.88 CHF, conservative)
    const USD_TO_CHF = 0.88;

    return result.body.data.slice(0, 3).map(card => {
      const priceUsd = card.market_price || card.low_price || card.median_price;
      if (!priceUsd || priceUsd <= 0) return null;
      const priceCHF = (parseFloat(priceUsd) * USD_TO_CHF).toFixed(2);
      const label = card.printing === 'Foil' ? ' (Foil)' : '';
      return {
        title: `${card.name}${card.set_name ? ' · ' + card.set_name : ''}${label}`.substring(0, 70),
        price: priceCHF,
        currency: 'CHF',
        url: null,
        condition: card.rarity || null,
        source: 'TCGapi'
      };
    }).filter(Boolean);
  } catch(e) {
    console.error('TCGapi error:', e.message);
    return [];
  }
}



// ── Specialized antique price estimation ────────────────────────────────────
// Uses style period, material, era, and maker mark for much higher accuracy
// than generic product price estimation
async function estimateAntiquePriceWithAI(objectInfo) {
  const lines = [
    "Du bist ein Experte für Antiquitäten und alte Möbel mit tiefem Wissen des deutschen und Schweizer Marktes.",
    "Schätze den realistischen SECONDHAND-Marktpreis (Verkaufspreis zwischen Privaten) für dieses Objekt.",
    "",
    `Objekt: ${objectInfo.objectName}`,
    objectInfo.stylePeriod  ? `Stilepoche: ${objectInfo.stylePeriod}` : null,
    objectInfo.estimatedEra ? `Geschätzte Periode: ${objectInfo.estimatedEra}` : null,
    objectInfo.material     ? `Material: ${objectInfo.material}` : null,
    objectInfo.subType      ? `Möbeltyp: ${objectInfo.subType}` : null,
    objectInfo.brand        ? `Hersteller/Maker: ${objectInfo.brand}` : null,
    objectInfo.makerMark && objectInfo.makerMark !== 'null'
      ? `Maker-Markierung: ${objectInfo.makerMark}` : null,
    `Zustand: ${objectInfo.condition || 'Gut'}`,
    "",
    "Wichtige Marktfaktoren:",
    "- Biedermeier (1820-1848): Kommode CHF 800-3000, Sekretär CHF 1500-5000, Stuhl CHF 200-800",
    "- Jugendstil/Art Nouveau (1890-1910): CHF 500-8000 je nach Stück und Hersteller",
    "- Art Deco (1920-1940): CHF 400-6000",
    "- Gründerzeit (1870-1890): CHF 300-2000",
    "- Unbekannte Hersteller: 30-50% Abschlag vs. bekannte Manufakturen",
    "- Maker-Markierung vorhanden: +20-40% Aufschlag",
    "- Schlechter Zustand: -40-60%",
    "",
    "Antworte NUR mit gültigem JSON: {"priceMin": Zahl, "priceMax": Zahl, "marketAvg": Zahl, "priceNote": "kurze Begründung max 15 Wörter"}"
  ].filter(l => l !== null).join("\n");

  const result = await httpsPost("api.openai.com", "/v1/chat/completions",
    {"Content-Type": "application/json", "Authorization": "Bearer " + process.env.OPENAI_API_KEY},
    {model: "gpt-4o-mini", max_tokens: 150, messages: [{role: "user", content: lines}]}
  );
  const raw = result.body.choices?.[0]?.message?.content || "{}";
  const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const p = JSON.parse(clean);
    if (p.priceMin && p.priceMax) {
      return {
        priceMin:     String(p.priceMin),
        priceMax:     String(p.priceMax),
        marketAvg:    String(p.marketAvg || ((p.priceMin + p.priceMax) / 2).toFixed(0)),
        listingCount: 0,
        aiEstimate:   true,
        antiqueNote:  p.priceNote || null
      };
    }
    return null;
  } catch(e) { return null; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { image, barcode=null, mode='resell', buyPrice=0, sellPrice=0, askedPrice=0, condition=null, userBrand=null, userModel=null, userYear=null, userSize=null, userCategory=null, userRef=null } = req.body || {};
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
    } else if ((userBrand || userModel) && image) {
      // Brand or model provided: use confirmed facts + vision
      objectInfo = await identifyWithBrand(image, userBrand, userModel, userSize, userCategory, userRef);
    } else {
      // Standard vision identification
      objectInfo = await identifyObject(image);
    }
    if (condition) objectInfo.condition = condition;
    if (userBrand) objectInfo.brand = userBrand;
    if (userModel) objectInfo.model = userModel;
    if (userYear)  objectInfo.year  = userYear;

    // CONFIRMED FACTS override: force model into objectName + ebaySearchQuery
    if (userModel) {
      const confirmedBrand = userBrand || objectInfo.brand || '';
      // Only override objectName if GPT's name doesn't already contain the confirmed model
      // (preserves full product names like "Garmin Descent MK2i" when user inputs "MK2i")
      if (!objectInfo.objectName || !objectInfo.objectName.toLowerCase().includes(userModel.toLowerCase())) {
        objectInfo.objectName = [confirmedBrand, userModel, userYear].filter(Boolean).join(' ');
      }
      // Force model into eBay query if not already present
      const q = objectInfo.ebaySearchQuery || '';
      if (!q.toLowerCase().includes(userModel.toLowerCase())) {
        objectInfo.ebaySearchQuery = [confirmedBrand, userModel, userYear].filter(Boolean).join(' ');
        objectInfo.ebaySearchQueryBroad = [confirmedBrand, userModel].filter(Boolean).join(' ');
      }
    } else if (userBrand) {
      // Brand only: prepend to GPT's query if not already there
      if (objectInfo.ebaySearchQuery && !objectInfo.ebaySearchQuery.toLowerCase().startsWith(userBrand.toLowerCase())) {
        objectInfo.ebaySearchQuery = userBrand + ' ' + objectInfo.ebaySearchQuery;
      }
    }

    // Normalize confidence: GPT sometimes returns 0-1 scale instead of 0-100
    if (objectInfo.confidence != null && objectInfo.confidence <= 1) {
      objectInfo.confidence = Math.round(objectInfo.confidence * 100);
    }

    // Boost confidence when user provided confirmed inputs — suppresses misleading warning
    if (userModel || userBrand) {
      objectInfo.confidence = Math.max(objectInfo.confidence || 0, 80);
    }

    let ebayData = null;
    let retailData = null;
    let soldData = null;
    let usedFallbackQuery = false;

    // eBay category: use GPT's detected category only — userCategory is a hint to GPT, not forced here
    // This ensures sport watches (Garmin → Elektronik) aren't filtered into luxury watch category
    const categoryEbayId = getCategoryEbayId(
      objectInfo.category,
      objectInfo.subType || null,
      objectInfo.stylePeriod || null,
      objectInfo.isAntique || false
    );

    // Query hierarchy: confirmed-facts query → GPT-broad → user fields → objectName
    let specificQuery = objectInfo.ebaySearchQuery ||
      [userBrand, userModel, userYear].filter(Boolean).join(' ') ||
      objectInfo.objectName;
    let broadQuery = objectInfo.ebaySearchQueryBroad || null;

    // For antiques: build richer query from stylePeriod + subType + material if GPT identified them
    const isAntiqueItem = objectInfo.isAntique ||
      objectInfo.category === 'Antiquitäten & Kunst' ||
      (objectInfo.stylePeriod && objectInfo.stylePeriod !== 'null' && objectInfo.stylePeriod !== null);

    if (isAntiqueItem && !userModel && !userBrand) {
      // Build antique-specific query: style + furniture type + material
      const antiqueParts = [
        objectInfo.stylePeriod,
        objectInfo.subType,
        objectInfo.material,
      ].filter(p => p && p !== 'null');
      if (antiqueParts.length >= 2) {
        specificQuery = antiqueParts.slice(0, 4).join(' ');
        broadQuery = antiqueParts.slice(0, 2).join(' ');
        console.log('Antique query built:', specificQuery);
      }
    }

    // Force year into queries when user-provided (iPhone 13 ≠ iPhone 14)
    if (userYear) {
      if (!specificQuery.includes(userYear)) specificQuery = specificQuery + ' ' + userYear;
      if (broadQuery && !broadQuery.includes(userYear)) broadQuery = broadQuery + ' ' + userYear;
    }

    // Condition-aware query: damaged items live in a different price segment on eBay
    const isDefekt = (condition || objectInfo.condition || '').toLowerCase().includes('beschaed');
    if (isDefekt) {
      if (!specificQuery.toLowerCase().includes('defekt')) specificQuery = specificQuery + ' defekt';
      if (broadQuery && !broadQuery.toLowerCase().includes('defekt')) broadQuery = broadQuery + ' defekt';
    }

    const searchQuery = specificQuery; // used by non-eBay sources

    try {
      // Retail price + secondary sources: start in parallel immediately
      const retailPromise = (async () => {
        const keepa = await getKeepaRetailPrice(specificQuery);
        if (keepa) return keepa;
        return estimateRetailPrice(objectInfo, specificQuery);
      })();
      const soldPromise    = withTimeout(getEbaySoldPrices(specificQuery, categoryEbayId), 4000, null);
      const vintedPromise  = withTimeout(getVintedListings(specificQuery), 2000, []);
      const pcPromise      = withTimeout(getPriceChartingListings(specificQuery), 2000, []);
      const kleinPromise   = withTimeout(getKleinanzeigenListings(specificQuery), 3000, []);
      const ricardoPromise = withTimeout(getRicardoListings(specificQuery), 3000, []);
      // TCGapi: only for trading cards (Sammler category + recognizable game)
      const isTCGCategory = (objectInfo.category === 'Sammler') && detectTCGGame(specificQuery, objectInfo.objectName);
      const tcgPromise     = isTCGCategory
        ? withTimeout(getTCGApiListings(specificQuery, objectInfo.objectName), 4000, [])
        : Promise.resolve([]);


      // eBay: sequential fallback (specific → broad → objectName), all with category filter
      ebayData = await getEbayPrices(specificQuery, categoryEbayId);
      if ((!ebayData || ebayData.listingCount < 5) && broadQuery && broadQuery !== specificQuery) {
        console.log(`eBay fallback B: "${broadQuery}" (was: ${ebayData?.listingCount || 0} results)`);
        const broadResult = await getEbayPrices(broadQuery, categoryEbayId);
        if (broadResult && broadResult.listingCount > (ebayData?.listingCount || 0)) {
          ebayData = broadResult;
          usedFallbackQuery = true;
        }
      }
      if (!ebayData || ebayData.listingCount < 3) {
        const nameQuery = objectInfo.objectName;
        if (nameQuery && nameQuery !== specificQuery && nameQuery !== broadQuery) {
          console.log(`eBay fallback C: "${nameQuery}"`);
          const nameResult = await getEbayPrices(nameQuery, categoryEbayId);
          if (nameResult && nameResult.listingCount > (ebayData?.listingCount || 0)) {
            ebayData = nameResult;
            usedFallbackQuery = true;
          }
        }
      }

      // Collect parallel results (eBay already resolved above)
      const [retailResult, soldResult, vintedResult, pcResult, kleinResult, ricardoResult, tcgResult] = await Promise.allSettled([
        retailPromise, soldPromise, vintedPromise, pcPromise, kleinPromise, ricardoPromise, tcgPromise
      ]);
      if (retailResult.status === 'fulfilled') retailData = retailResult.value;
      if (soldResult.status === 'fulfilled') soldData = soldResult.value;
      // If UPC lookup returned retail price range, use as fallback
      if (!retailData && objectInfo.upcRetailPriceMin) {
        const mid = ((objectInfo.upcRetailPriceMin + objectInfo.upcRetailPriceMax) / 2);
        retailData = { retailPrice: mid.toFixed(2), retailConfidence: 'high' };
      }
      const vintedListings   = vintedResult.status   === 'fulfilled' ? vintedResult.value   : [];
      const pcListings       = pcResult.status       === 'fulfilled' ? pcResult.value       : [];
      const kleinListings    = kleinResult.status    === 'fulfilled' ? kleinResult.value    : [];
      const ricardoListings  = ricardoResult.status  === 'fulfilled' ? ricardoResult.value  : [];
      const tcgListings      = tcgResult.status      === 'fulfilled' ? tcgResult.value      : [];
      if (tcgListings.length) console.log(`TCGapi: ${tcgListings.length} results for "${specificQuery}"`);


      // Merge all sources into topListings
      if (ebayData) {
        const extra = [...vintedListings, ...pcListings, ...kleinListings, ...ricardoListings, ...tcgListings];
        ebayData.topListings = [...(ebayData.topListings || []).map(l => ({...l, source:'eBay'})), ...extra];
      } else if (kleinListings.length || ricardoListings.length || vintedListings.length) {
        // No eBay data: build synthetic ebayData from other sources for display
        const allExtra = [...vintedListings, ...kleinListings, ...ricardoListings, ...pcListings, ...tcgListings];
        const prices = allExtra.map(l => parseFloat(l.price)).filter(p => p > 0);
        if (prices.length) {
          const avg = (prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(2);
          ebayData = { priceMin: Math.min(...prices).toFixed(2), priceMax: Math.max(...prices).toFixed(2),
            marketAvg: avg, listingCount: prices.length, aiEstimate: false, topListings: allExtra };
        }
      }
    } catch(e) { console.error('Data fetch error:', e.message); }
    if (!ebayData) {
      try {
        const isAntiqueCategory = objectInfo.isAntique ||
          objectInfo.category === 'Antiquitäten & Kunst' ||
          (objectInfo.stylePeriod && objectInfo.stylePeriod !== 'null') ||
          (objectInfo.category === 'Möbel & Wohnen' && objectInfo.estimatedEra);
        if (isAntiqueCategory) {
          console.log('Antique fallback pricing for:', objectInfo.objectName, objectInfo.stylePeriod);
          ebayData = await estimateAntiquePriceWithAI(objectInfo);
        }
        if (!ebayData) ebayData = await estimatePriceWithAI(objectInfo);
      } catch(e2) { console.error('AI price fallback:', e2.message); }
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
        soldAvg: soldData?.soldAvg||null, soldMin: soldData?.soldMin||null,
        soldMax: soldData?.soldMax||null, soldCount: soldData?.soldCount||null,
        retailPrice: retailData?.retailPrice||null, retailConfidence: retailData?.retailConfidence||null,
        retailSource: retailData?.retailSource||null,
        topListings: ebayData?.topListings||[],
        ebaySearchUrl, amazonSearchUrl,
        confidence: objectInfo.confidence || null,
        usedFallbackQuery,
        contextInfo:  objectInfo.contextInfo  || null,
        stylePeriod:  objectInfo.stylePeriod  || null,
        estimatedEra: objectInfo.estimatedEra || null,
        material:     objectInfo.material     || null,
        makerMark:    objectInfo.makerMark    || null,
        isAntique:    objectInfo.isAntique    || false,
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
      soldAvg: soldData?.soldAvg||null, soldMin: soldData?.soldMin||null,
      soldMax: soldData?.soldMax||null, soldCount: soldData?.soldCount||null,
      demandScore, demandLabel, timeToSell, channels, aiNote,
      retailPrice: retailData?.retailPrice||null, retailConfidence: retailData?.retailConfidence||null,
      retailSource: retailData?.retailSource||null,
      topListings: ebayData?.topListings||[],
      ebaySearchUrl, amazonSearchUrl,
      confidence: objectInfo.confidence || null,
      usedFallbackQuery,
      contextInfo:  objectInfo.contextInfo  || null,
      stylePeriod:  objectInfo.stylePeriod  || null,
      estimatedEra: objectInfo.estimatedEra || null,
      material:     objectInfo.material     || null,
      makerMark:    objectInfo.makerMark    || null,
      isAntique:    objectInfo.isAntique    || false,
    });

  } catch(err) {
    console.error('Analysis error:', err);
    return res.status(500).json({ error: err.message || 'Analyse fehlgeschlagen' });
  }
};

// This line intentionally left blank - file integrity check
