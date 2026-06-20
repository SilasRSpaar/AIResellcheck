// feedback.js - Comparadoo Feedback API
'use strict';
const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not configured');
    return res.status(503).json({ error: 'Feedback not configured' });
  }

  const b = req.body || {};
  const issueType   = b.issueType   || '';
  const comment     = b.comment     || '';
  const objectName  = b.objectName  || '';
  const brand       = b.brand       || '';
  const model       = b.model       || '';
  const category    = b.category    || '';
  const priceMin    = b.priceMin;
  const priceMax    = b.priceMax;
  const marketAvg   = b.marketAvg;
  const confidence  = b.confidence;
  const mode           = b.mode           || '';
  const userAgent      = b.userAgent      || '';
  const timestamp      = b.timestamp      || new Date().toISOString();
  const userCorrection   = b.userCorrection   || '';
  const priceDirection   = b.priceDirection   || '';
  const correctCategory  = b.correctCategory  || '';
  const ebayQuery        = b.ebayQuery        || '';
  const sourcesUsed      = b.sourcesUsed      || [];

  if (!issueType) return res.status(400).json({ error: 'issueType required' });

  const priceStr   = (priceMin && priceMax) ? ('CHF ' + priceMin + '-' + priceMax + (marketAvg ? ' (avg ' + marketAvg + ')' : '')) : '-';
  const objDisplay = [objectName, brand, model].filter(Boolean).join(' / ') || '-';
  const modeLabel  = mode === 'fairness' ? 'Fairness-Check' : 'Resell';

  const issueColors = { 'Falsches Objekt': '#E53E3E', 'Falscher Preis': '#DD6B20', 'Falsche Kategorie': '#6B46C1', 'App-Fehler': '#9B2C2C', 'Anderes': '#2B6CB0' };
  const issueColor = issueColors[issueType] || '#185FA5';

  const priceDirLabel = priceDirection === 'zu_hoch' ? '⬆ Zu hoch' : priceDirection === 'zu_tief' ? '⬇ Zu tief' : '-';

  const rows = [
    ['Fehlertyp',         '<span style="color:' + issueColor + ';font-weight:700">' + issueType + '</span>'],
    ['KI-Objekt (war)',   objDisplay],
    ['KI-Kategorie (war)',category || '-'],
    ['Richtige Antwort',  userCorrection || '-'],
    ['Korrekte Kategorie',correctCategory ? '<strong style="color:' + issueColor + '">' + correctCategory + '</strong>' : '-'],
    ['Preis-Richtung',    priceDirLabel],
    ['Preis (war)',       priceStr],
    ['Kommentar',         comment || '-'],
    ['Confidence',        confidence != null ? confidence + '%' : '-'],
    ['Modus',             modeLabel],
    ['eBay Query',        ebayQuery || '-'],
    ['Quellen',           sourcesUsed.length ? sourcesUsed.join(', ') : '-'],
    ['Zeitstempel',       timestamp],
    ['User-Agent',        '<span style="font-size:11px;color:#999">' + userAgent.substring(0, 120) + '</span>'],
  ];

  const tableRows = rows.map(function(row, i) {
    return '<tr style="background:' + (i % 2 === 0 ? '#f9fafb' : '#ffffff') + '">' +
      '<td style="padding:8px 12px;font-weight:600;color:#555;white-space:nowrap;border-bottom:1px solid #eee">' + row[0] + '</td>' +
      '<td style="padding:8px 12px;color:#222;border-bottom:1px solid #eee">' + row[1] + '</td>' +
      '</tr>';
  }).join('');

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">' +
    '<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">' +
    '<tr><td style="background:#080C18;padding:20px 28px"><span style="color:#185FA5;font-size:22px;font-weight:900">Comparadoo</span>' +
    '<span style="color:#fff;font-size:14px;margin-left:12px;opacity:.7">Feedback Report</span></td></tr>' +
    '<tr><td style="background:' + issueColor + ';padding:12px 28px"><span style="color:#fff;font-weight:700;font-size:16px">' + issueType + '</span></td></tr>' +
    '<tr><td><table width="100%" cellpadding="0" cellspacing="0">' + tableRows + '</table></td></tr>' +
    '<tr><td style="padding:16px 28px;background:#f9fafb;text-align:center"><span style="color:#999;font-size:12px">Comparadoo - comparadoo.com</span></td></tr>' +
    '</table></td></tr></table></body></html>';

  const emailBody = JSON.stringify({
    from: 'Comparadoo Feedback <info@comparadoo.com>',
    to: ['info@comparadoo.com'],
    subject: '[Comparadoo] ' + issueType + ' - ' + (objectName || 'Unbekannt').substring(0, 50),
    html: html,
  });

  try {
    const result = await new Promise(function(resolve, reject) {
      const options = {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(emailBody),
        },
      };
      const r = https.request(options, function(resp) {
        let raw = '';
        resp.on('data', function(c) { raw += c; });
        resp.on('end', function() { resolve({ status: resp.statusCode, body: raw }); });
      });
      r.on('error', reject);
      r.write(emailBody);
      r.end();
    });

    if (result.status >= 200 && result.status < 300) {
      return res.status(200).json({ ok: true });
    } else {
      console.error('Resend error:', result.status, result.body.substring(0, 200));
      return res.status(502).json({ error: 'Email delivery failed', resendStatus: result.status });
    }
  } catch (err) {
    console.error('Feedback error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
