// feedback.js — Comparadoo Feedback API
// Empfängt strukturiertes Feedback vom Frontend und sendet HTML-Email via Resend

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

  const {
    issueType,    // z.B. "Falscher Preis"
    comment,      // optionaler Freitext
    objectName,
    brand,
    model,
    category,
    priceMin,
    priceMax,
    marketAvg,
    confidence,
    mode,         // "resell" | "fairness"
    userAgent,
    timestamp,
  } = req.body || {};

  if (!issueType) {
    return res.status(400).json({ error: 'issueType required' });
  }

  const priceStr = (priceMin && priceMax)
    ? `CHF ${priceMin}–${priceMax}${marketAvg ? ` (Ø ${marketAvg})` : ''}`
    : '–';

  const issueColors = {
    'Falsches Objekt': '#E53E3E',
    'Falscher Preis':  '#DD6B20',
    'App-Fehler':      '#9B2C2C',
    'Anderes':         '#2B6CB0',
  };
  const issueColor = issueColors[issueType] || '#185FA5';

  const objectDisplay = [objectName, brand, model].filter(Boolean).join(' · ') || '–';

  const rows = [
    ['Fehlertyp',   `<span style="color:${issueColor};font-weight:700">${issueType}</span>`],
    ['Objekt',      objectDisplay],
    ['Kategorie',   category || '–'],
    ['Preisanzeige', priceStr],
    ['Confidence',  confidence != null ? `${confidence}%` : '–'],
    ['Modus',       mode === 'fairness' ? 'Fairness-Check' : 'Resell-Schätzung'],
    ['Zeitstempel', timestamp || new Date().toISOString()],
    ['User-Agent',  `<span style="font-size:11px;color:#999">${userAgent || '–'}</span>`],
  ];
  if (comment) {
    rows.splice(2, 0, ['Kommentar', `<em>${comment}</em>`]);
  }

  const tableRows = rows.map(([label, value], i) => `
    <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'}">
      <td style="padding:8px 12px;font-weight:600;color:#555;white-space:nowrap;border-bottom:1px solid #eee">${label}</td>
      <td style="padding:8px 12px;color:#222;border-bottom:1px solid #eee">${value}</td>
    </tr>`).join('');

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
        <!-- Header -->
        <tr>
          <td style="background:#080C18;padding:20px 28px;text-align:left">
            <span style="color:#185FA5;font-size:22px;font-weight:900;letter-spacing:-0.5px">Comparadoo</span>
            <span style="color:#ffffff;font-size:14px;margin-left:12px;opacity:0.7">Feedback Report</span>
          </td>
        </tr>
        <!-- Issue Banner -->
        <tr>
          <td style="background:${issueColor};padding:12px 28px">
            <span style="color:#ffffff;font-weight:700;font-size:16px">${issueType}</span>
            ${comment ? `<br><span style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px;display:block">"${comment}"</span>` : ''}
          </td>
        </tr>
        <!-- Data Table -->
        <tr>
          <td style="padding:0">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${tableRows}
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #eee;text-align:center">
            <span style="color:#999;font-size:12px">Comparadoo · comparadoo.com · Automatisch generiert</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Comparadoo Feedback <onboarding@resend.dev>',
        to: ['silas.spaar@gmail.com'],
        subject: `[Comparadoo] ${issueType} — ${objectDisplay}`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error('Resend API error:', emailRes.status, errText.substring(0, 200));
      return res.status(502).json({ error: 'Email delivery failed' });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Feedback handler error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
