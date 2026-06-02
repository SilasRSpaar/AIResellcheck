# ResellCheck – Setup in 15 Minuten

## Was du brauchst
1. GitHub Account (kostenlos) → github.com
2. Vercel Account (kostenlos) → vercel.com
3. OpenAI API Key → platform.openai.com
4. eBay Developer Account → developer.ebay.com

---

## Schritt 1: API Keys holen

### OpenAI (5 min)
1. Geh zu https://platform.openai.com/api-keys
2. Klick „Create new secret key"
3. Key kopieren und sicher aufbewahren (wird nur einmal angezeigt)
4. Guthaben aufladen: https://platform.openai.com/settings/billing
   → Empfehlung: USD 10 zum Starten (reicht für ~500 Analysen)

### eBay Developer (10 min)
1. Geh zu https://developer.ebay.com
2. Account erstellen → „My Account" → „Application Access"
3. Neue App anlegen: „ResellCheck"
4. „Keyset" auswählen → **Production** Client ID und Client Secret kopieren

---

## Schritt 2: Code auf GitHub laden

1. GitHub.com → „New repository" → Name: `resellcheck` → Public → Create
2. Auf deinem Computer: Terminal öffnen im Ordner `resell-app`
3. Befehle:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/resellcheck.git
git push -u origin main
```

---

## Schritt 3: Auf Vercel deployen

1. Geh zu https://vercel.com → „Add New Project"
2. „Import Git Repository" → dein `resellcheck` Repo auswählen
3. Klick „Deploy" (Einstellungen bleiben Standard)

---

## Schritt 4: API Keys in Vercel eintragen

1. Vercel → dein Projekt → „Settings" → „Environment Variables"
2. Diese drei Variables hinzufügen:

| Name | Wert |
|------|------|
| OPENAI_API_KEY | dein OpenAI Key (sk-...) |
| EBAY_CLIENT_ID | dein eBay Client ID |
| EBAY_CLIENT_SECRET | dein eBay Client Secret |

3. „Save" → dann „Deployments" → „Redeploy"

---

## Schritt 5: App auf Handy installieren

1. Vercel gibt dir eine URL wie `https://resellcheck.vercel.app`
2. Diese URL auf dem Handy im Safari (iOS) oder Chrome (Android) öffnen
3. iOS: Teilen-Button → „Zum Home-Bildschirm hinzufügen"
4. Android: Menü → „App installieren" oder „Zum Startbildschirm hinzufügen"

Fertig – die App ist jetzt wie eine native App auf deinem Handy.

---

## Kosten im Betrieb

| Service | Kosten |
|---------|--------|
| Vercel Hosting | Kostenlos (Hobby Plan reicht) |
| OpenAI GPT-4o | ~CHF 0.02 pro Analyse |
| OpenAI GPT-4o-mini | ~CHF 0.001 pro Zusammenfassung |
| eBay API | Kostenlos |
| **Total pro Analyse** | **~CHF 0.02** |

Bei 100 Analysen/Monat: ~CHF 2.–
