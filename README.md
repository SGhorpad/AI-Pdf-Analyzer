# PDF Analyser (React + Express)

A plain React (Vite) frontend paired with a small Express backend. The
backend does the Gemini API call server-side, so the API key never reaches
the browser.

```
pdf-analyser-react/
├── backend/          # Express server — the only place that calls Gemini
│   ├── server.js
│   ├── package.json
│   └── .env.example
└── frontend/          # Vite + React UI
    ├── src/
    │   ├── App.jsx
    │   ├── main.jsx
    │   └── index.css
    ├── index.html
    ├── package.json
    └── .env.example
```

## Why two folders

Plain React only runs in the browser — it has no server. Since the
assignment requires the LLM call to happen server-side (API key never
exposed to the frontend), something has to be the "server." That's the
`backend/` folder: a small Express app with one route, `/api/analyze`.

## Local setup

**1. Backend**
```bash
cd backend
npm install
cp .env.example .env
# edit .env and paste your Gemini API key
npm run dev
```
This starts the API at http://localhost:3001.

**2. Frontend** (in a second terminal)
```bash
cd frontend
npm install
npm run dev
```
This starts the UI at http://localhost:5173.

Open http://localhost:5173, paste a PDF URL (e.g.
`https://arxiv.org/pdf/1706.03762`), and click Analyse.

### Getting a Gemini API key

Go to https://aistudio.google.com, sign in, click **Get API key** in the
sidebar, then **Create API key**. No credit card required. Paste it into
`backend/.env` as `GEMINI_API_KEY`.

Google's Gemini lineup changes fairly often — `GEMINI_MODEL` defaults to
`gemini-flash-latest`, an alias Google keeps pointed at their current
recommended Flash model, so you shouldn't need to update it when a specific
version gets retired.

## Deploying

Because this is two separate apps, deploy them separately:

**Backend → Render (or Railway/Fly.io/any Node host)**
1. Push this project to GitHub.
2. On Render: New → Web Service → point at the repo, set the root directory
   to `backend`.
3. Build command: `npm install`. Start command: `npm start`.
4. Add environment variables: `GEMINI_API_KEY`, `GEMINI_MODEL` (optional),
   and `FRONTEND_ORIGIN` (set this to your deployed frontend's URL once you
   have it, e.g. `https://your-app.vercel.app`).
5. Deploy. Note the resulting URL, e.g. `https://your-app.onrender.com`.

**Frontend → Vercel (or Netlify)**
1. On Vercel: New Project → point at the same repo, set the root directory
   to `frontend`.
2. Framework preset: Vite (auto-detected).
3. Add environment variable `VITE_API_URL` = your backend's URL from above.
4. Deploy.

Once both are live, open the frontend URL and confirm it can reach the
backend (check the browser Network tab if something looks off — a CORS
error there usually means `FRONTEND_ORIGIN` on the backend doesn't match the
frontend's actual deployed URL).

## Design notes worth knowing before the interview

- **CORS is locked to one origin** (`FRONTEND_ORIGIN`) rather than left open
  to `*`, so random sites can't call your backend from a user's browser.
- **Every failure path returns a specific error message** (bad URL,
  unreachable URL, non-PDF, oversized file, Gemini failure, unparsable
  output, rate limit) instead of a generic crash.
- **`gemini-flash-latest`** is used instead of a pinned model version,
  because Google has been deprecating specific Gemini versions with very
  little notice this year — an alias avoids repeating that debugging cycle.
- **The PDF is sent to Gemini directly as `inline_data`** rather than
  extracted to text first with a separate library — Gemini reads PDFs
  natively (layout, images included), which is simpler and more robust.

### How this would change at scale

- Rate limit /api/analyze per IP (e.g. with `express-rate-limit`) so one
  user can't exhaust your Gemini quota for everyone else.
- Cache results by PDF URL (or a content hash) so repeat requests don't
  re-call the LLM.
- Move the backend behind a queue if PDF downloads or Gemini calls start
  timing out under load.
- Add structured logging/monitoring (e.g. Sentry) around the Gemini call
  specifically, since that's the most likely failure point in production.
