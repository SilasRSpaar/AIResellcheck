// ResellCheck – Serverless API Function (Vercel)
// Chains: OpenAI Vision → eBay Sold Listings → Analysis

const https = require('https');

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Step 1: OpenAI Vision – identify object ───────────────────────────────────

async function identifyObject(base64Image) {
  const result = await httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    {
      model: 'gpt-4o',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'low' },
            },
            {
              type: 'text',
              text: `Identify this object for resale analysis. Respond ONLY with a valid JSON object (no markdown, no extra text) with these exact fields:
{
  "objectName": "spezifischer Produktname und Modell auf Deutsch, z.B. 'iPhone 13 Pro 256GB' oder 'Levi's 501 Jeans'",
  "category": "eine dieser Kategorien auf Deutsch: Elektronik, Kleidung, Spielzeug, Möbel, Schmuck, Uhren, Sport, Bücher, Haushalt, Sonstiges",
  "brand": "Markenname oder null",
  "condition": "eines von: Neu / Sehr gut / Gut / Akzeptabel / Beschädigt",
  "ebaySearchQuery": "best English search query for eBay sold listings (max 5 words, include brand and model)",
  "confidence": 0-100
}`,
            },
          ],
        },
      ],
    }
  );

  if (result.status !== 200) throw new Error('OpenAI API Fehler: ' + JSON.stringify(result.body));
  const content = result.body.choices?.[0]?.message?.content || '{}';
  // Strip markdown code blocks if present
  const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(clean);
}

// ── Step 2: eBay Browse API – sold/active listings ───────────────────────────

async function getEbayPrices(searchQuery) {
  // Get eBay OAuth token (Client Credentials flow)
  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64');

  const tokenRes = await new Promise((resolve, reject) => {
    const body = 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope';
    const req = https.request(
      {
        hostname: 'api.ebay.com',
        path: '/identity/v1/oauth2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve(JSON.parse(raw)));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (!tokenRes.access_token) throw new Error('eBay Auth fehlgeschlagen');

  // Search active listings on eBay DE (German/Swiss market)
  const encoded = encodeURIComponent(searchQuery);
  const searchRes = await httpsGet(
    'api.ebay.com',
    `/buy/browse/v1/item_summary/search?q=${encoded}&limit=30&sort=price&filter=conditionIds:%7B1000|1500|2000|2500|3000%7D`,
    {
      Authorization: `Bearer ${tokenRes.access_token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE',
      'Content-Type': 'application/json',
    }
  );

  const items = searchRes.body?.itemSummaries || [];
  if (items.length === 0) return null;

  const prices = items
    .map((i) => parseFloat(i.price?.value || 0))
    .filter((p) => p > 0)
    .sort((a, b) => a - b);

  // Remove top and bottom 10% outliers for more accurate average
  const trimCount = Math.floor(prices.length * 0.1);
  const trimmed = prices.slice(trimCount, prices.length - trimCount || undefined);
  const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const min = prices[Math.floor(prices.length * 0.1)]; // 10th percentile
  const max = prices[Math.floor(prices.length * 0.9)]; // 90th percentile
  const soldCount = items.length;

  return {
    priceMin: min.toFixed(2),
    priceMax: max.toFixed(2),
    marketAvg: avg.toFixed(2),
    listingCount: soldCount,
  };
}

// ── Step 3: Demand & channel logic ────────────────────────────────────────────

function analyzeDemandAndChannels(objectInfo, ebayData, buyPrice, sellPrice) {
  const listingCount = ebayData?.listingCount || 0;

  // Demand score: based on listing count (proxy for market activity)
  let demandScore = Math.min(100, Math.round((listingCount / 20) * 100));
  if (listingCount >= 15) demandScore = Math.max(demandScore, 70);
  if (listingCount >= 8) demandScore = Math.max(demandScore, 45);
  if (listingCount === 0) demandScore = 15;

  const demandLabel =
    demandScore >= 70 ? 'Hohe Nachfrage' :
    demandScore >= 40 ? 'Mittlere Nachfrage' :
    'Niedrige Nachfrage';

  // Time to sell estimate
  const timeToSell =
    demandScore >= 70 ? '1–7 Tage' :
    demandScore >= 40 ? '1–4 Wochen' :
    '1–3 Monate';

  // Channel recommendations by category
  const cat = (objectInfo.category || '').toLowerCase();
  let channels = [];

  if (cat.includes('elektron') || cat.includes('computer') || cat.includes('handy')) {
    channels = [
      { name: 'Ricardo.ch', reason: 'Grösster CH-Marktplatz für Elektronik' },
      { name: 'eBay.de', reason: 'Grosse Reichweite in DACH' },
      { name: 'Facebook Marketplace', reason: 'Lokal & schnell' },
    ];
  } else if (cat.includes('kleider') || cat.includes('mode') || cat.includes('kleidung')) {
    channels = [
      { name: 'Vinted', reason: 'Beste Plattform für Mode in CH' },
      { name: 'Tutti.ch', reason: 'Lokale Käufer, schnell' },
      { name: 'Facebook Marketplace', reason: 'Kostenlos & direkt' },
    ];
  } else if (cat.includes('schmuck') || cat.includes('uhren') || cat.includes('luxus')) {
    channels = [
      { name: 'Chrono24 / Catawiki', reason: 'Spezialisiert auf Luxusgüter' },
      { name: 'Ricardo.ch', reason: 'Gut für Schweizer Käufer' },
      { name: 'eBay.de', reason: 'Internationale Reichweite' },
    ];
  } else if (cat.includes('möbel') || cat.includes('wohnen')) {
    channels = [
      { name: 'Facebook Marketplace', reason: 'Ideal für Möbel (Abholung)' },
      { name: 'Tutti.ch', reason: 'Starke lokale Präsenz in CH' },
      { name: 'Ricardo.ch', reason: 'Bekannter CH-Marktplatz' },
    ];
  } else {
    channels = [
      { name: 'Ricardo.ch', reason: 'Grösster Schweizer Marktplatz' },
      { name: 'Tutti.ch', reason: 'Kostenlos, lokal' },
      { name: 'eBay.de', reason: 'Internationale Reichweite' },
    ];
  }

  return { demandScore, demandLabel, timeToSell, channels };
}

// ── Step 4: AI summary note ───────────────────────────────────────────────────

async function generateNote(objectInfo, ebayData, buyPrice, sellPrice, demandScore) {
  const profit = (sellPrice - buyPrice).toFixed(2);
  const roi = buyPrice > 0 ? (((sellPrice - buyPrice) / buyPrice) * 100).toFixed(0) : 0;

  const prompt = `Du bist ein Reselling-Experte. Analysiere diesen Deal in 1-2 Sätzen auf Deutsch.
Objekt: ${objectInfo.objectName} (${objectInfo.category})
Kaufpreis: CHF ${buyPrice}, Zielpreis: CHF ${sellPrice}
Gewinn: CHF ${profit} (ROI: ${roi}%)
Markt-Ø: CHF ${ebayData?.marketAvg || 'unbekannt'}
Nachfrage-Score: ${demandScore}/100
Sei direkt, ehrlich und praktisch. Keine Floskeln.`;


  const result = await httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    {
      model: 'gpt-4o-mini',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    }
  );

  return result.body.choices?.[0]?.message?.content?.trim() || '';
}

// ── Step 4b: AI fairness note ─────────────────────────────────────────────────

async function generateFairnessNote(objectInfo, ebayData, askedPrice) {
  const avg = parseFloat(ebayData?.marketAvg) || 0;
  const ratio = avg > 0 ? (askedPrice / avg).toFixed(2) : null;

  const prompt = `Du bist ein Marktpreis-Experte. Bewerte diesen Preis in 1-2 Sätzen auf Deutsch.
Objekt: ${objectInfo.objectName} (${objectInfo.category})
Verlangter Preis: CHF ${askedPrice}
Markt-Ø: CHF ${avg || 'unbekannt'}
Preisverhältnis: ${ratio ? ratio + 'x Marktpreis' : 'unbekannt'}
Sei direkt und sag ob es sich lohnt zu kaufen. Keine Floskeln.`;

  const result = await httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    {
      model: 'gpt-4o-mini',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    }
  );

  return result.body.choices?.[0]?.message?.content?.trim() || '';
}

// ── Main Handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, mode = 'resell', buyPrice = 0, sellPrice = 0, askedPrice = 0 } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Kein Bild übermittelt' });

  try {
    // 1. Identify object
    const objectInfo = await identifyObject(image);

    // 2. Get eBay prices (non-fatal if it fails)
    let ebayData = null;
    try {
      if (objectInfo.ebaySearchQuery) {
        ebayData = await getEbayPrices(objectInfo.ebaySearchQuery);
      }
    } catch (e) {
      console.error('eBay error (non-fatal):', e.message);
    }

    // 3. Mode-specific logic
    let aiNote = '';

    if (mode === 'fairness') {
      // Fairness mode: just need market data + AI note
      try {
        aiNote = await generateFairnessNote(objectInfo, ebayData, askedPrice);
      } catch (e) {
        console.error('AI fairness note error (non-fatal):', e.message);
      }

      return res.status(200).json({
        objectName: objectInfo.objectName,
        category:   objectInfo.category,
        brand:      objectInfo.brand,
        condition:  objectInfo.condition,
        priceMin:   ebayData?.priceMin   || null,
        priceMax:   ebayData?.priceMax   || null,
        marketAvg:  ebayData?.marketAvg  || null,
        aiNote,
      });
    }

    // Resell mode (default)
    const { demandScore, demandLabel, timeToSell, channels } = analyzeDemandAndChannels(
      objectInfo, ebayData, buyPrice, sellPrice
    );

    try {
      aiNote = await generateNote(objectInfo, ebayData, buyPrice, sellPrice, demandScore);
    } catch (e) {
      console.error('AI note error (non-fatal):', e.message);
    }

    return res.status(200).json({
      objectName: objectInfo.objectName,
      category:   objectInfo.category,
      brand:      objectInfo.brand,
      condition:  objectInfo.condition,
      priceMin:   ebayData?.priceMin   || null,
      priceMax:   ebayData?.priceMax   || null,
      marketAvg:  ebayData?.marketAvg  || null,
      demandScore,
      demandLabel,
      timeToSell,
      channels,
      aiNote,
    });
  } catch (err) {
    console.error('Analysis error:', err);
    return res.status(500).json({ error: err.message || 'Analyse fehlgeschlagen' });
  }
};
