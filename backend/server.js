import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { jsonrepair } from 'jsonrepair';

const app = express();
const PORT = process.env.PORT || 3001;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB safety cap
const FETCH_TIMEOUT_MS = 20_000; // fail fast instead of hanging on a slow host
const GEMINI_TIMEOUT_MS = 45_000; // large PDFs take longer to read than small ones

// In-memory cache: same PDF URL analysed twice returns instantly the second
// time, with no repeat Gemini call. Fine for a single Node process; would
// move to Redis if this ran across multiple instances.
const analysisCache = new Map(); // url -> { result, expiresAt }
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Allow the frontend's origin. In dev this is Vite's default port.
// In production, set FRONTEND_ORIGIN to your deployed frontend URL.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());

function isLikelyPdfUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractJson(text) {
  // Gemini sometimes wraps JSON in ```json ... ``` fences. Strip those first.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to auto-repairing common issues: trailing commas,
    // unterminated strings, duplicated fragments, stray text, etc.
    return JSON.parse(jsonrepair(candidate));
  }
}

// Wraps fetch with an AbortController so a slow/hanging host or a slow
// Gemini response fails fast with a clear error, instead of the request
// (and the user's loading spinner) hanging indefinitely.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`);
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Forces Gemini to emit exactly this shape natively, instead of relying on
// prompt instructions alone. This is the main fix for slow responses: most
// of the retry-loop cost below came from malformed JSON on attempt 1, and
// a native schema cuts that down sharply.
const ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    documentType: { type: 'STRING' },
    title: { type: 'STRING' },
    authors: { type: 'STRING' },
    summary: { type: 'STRING' },
    keyTakeaway: { type: 'STRING' },
  },
  required: ['documentType', 'title', 'authors', 'summary', 'keyTakeaway'],
};

async function callGemini(geminiUrl, prompt, base64Pdf) {
  const geminiResponse = await fetchWithTimeout(
    geminiUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'application/pdf', data: base64Pdf } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: ANALYSIS_SCHEMA,
        },
      }),
    },
    GEMINI_TIMEOUT_MS
  );

  if (!geminiResponse.ok) {
    const errorBody = await geminiResponse.text().catch(() => '');
    const err = new Error('Gemini API call failed');
    err.status = geminiResponse.status;
    err.body = errorBody;
    throw err;
  }

  const geminiJson = await geminiResponse.json();
  const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    const err = new Error('Unexpected Gemini response shape');
    err.raw = geminiJson;
    throw err;
  }

  return text;
}

app.post('/api/analyze', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error:
          'Server is missing GEMINI_API_KEY. Add it to your environment variables and restart.',
      });
    }

    const pdfUrl = req.body?.pdfUrl?.trim();

    if (!pdfUrl || !isLikelyPdfUrl(pdfUrl)) {
      return res
        .status(400)
        .json({ error: 'Please provide a valid, publicly accessible PDF URL.' });
    }

    // 0. Serve from cache if we've already analysed this exact URL recently.
    const cached = analysisCache.get(pdfUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return res.status(200).json({ ...cached.result, cached: true });
    }

    // 1. Fetch the PDF server-side.
    let pdfResponse;
    try {
      pdfResponse = await fetchWithTimeout(
        pdfUrl,
        { headers: { Accept: 'application/pdf' } },
        FETCH_TIMEOUT_MS
      );
    } catch (err) {
      return res.status(err.isTimeout ? 504 : 400).json({
        error: err.isTimeout
          ? 'That URL took too long to respond. Try a different host or a smaller file.'
          : 'Could not reach that URL. Double-check it is publicly accessible.',
      });
    }

    if (!pdfResponse.ok) {
      return res.status(400).json({
        error: `The URL responded with status ${pdfResponse.status}. Make sure it points directly to a PDF.`,
      });
    }

    // Reject oversized files before downloading the whole thing, when the
    // host tells us upfront via Content-Length. Saves bandwidth and time on
    // large files that would be rejected anyway.
    const declaredLength = Number(pdfResponse.headers.get('content-length') || 0);
    if (declaredLength > MAX_PDF_BYTES) {
      return res
        .status(400)
        .json({ error: 'The PDF is too large to analyse (limit is 15 MB).' });
    }

    const contentType = pdfResponse.headers.get('content-type') || '';
    const arrayBuffer = await pdfResponse.arrayBuffer();

    if (arrayBuffer.byteLength === 0) {
      return res.status(400).json({ error: 'The URL returned an empty file.' });
    }

    if (arrayBuffer.byteLength > MAX_PDF_BYTES) {
      return res
        .status(400)
        .json({ error: 'The PDF is too large to analyse (limit is 15 MB).' });
    }

    const looksLikePdf =
      contentType.includes('application/pdf') || pdfUrl.toLowerCase().endsWith('.pdf');

    if (!looksLikePdf) {
      return res
        .status(400)
        .json({ error: 'That URL does not appear to point to a PDF file.' });
    }

    const base64Pdf = Buffer.from(arrayBuffer).toString('base64');

    // 2. Send the PDF to Gemini and ask for a structured JSON analysis.
    const basePrompt = `You are a document analysis assistant. Analyse the attached PDF and respond with ONLY a raw JSON object (no markdown fences, no extra commentary, no duplicated text) with exactly these keys:

{
  "documentType": string,   // e.g. "Research Paper", "Legal Contract", "Financial Report", "Blog Post"
  "title": string,          // the document's title
  "authors": string,        // author(s) or organisation; write "Unknown" if not stated
  "summary": string,        // a 2-3 sentence summary of the document, as a single valid JSON string with no literal line breaks
  "keyTakeaway": string     // the single most important point from the document
}

The JSON must be strictly valid: no trailing commas, no repeated or duplicated sentences, all quotes and newlines inside strings properly escaped.`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const MAX_ATTEMPTS = 3;
    let parsed;
    let lastRawText;
    let lastError;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let text;
      try {
        // On retries, add an extra nudge to the prompt to discourage the
        // malformed/duplicated output seen on the previous attempt.
        const prompt =
          attempt === 1
            ? basePrompt
            : `${basePrompt}\n\nIMPORTANT: A previous attempt returned malformed JSON with duplicated sentences. Return clean, valid, non-duplicated JSON this time.`;

        text = await callGemini(geminiUrl, prompt, base64Pdf);
      } catch (err) {
        if (err.status === 429) {
          return res.status(429).json({
            error:
              "You've hit the Gemini free-tier rate limit (too many requests in a short window, or the daily cap). Wait a minute and try again.",
          });
        }
        if (err.isTimeout) {
          console.error('Gemini call timed out on attempt', attempt);
          lastError = err;
          continue; // large/complex PDFs sometimes need a fresh attempt
        }
        console.error('Gemini API error:', err.status || '', err.body || err.message);
        lastError = err;
        continue; // try again
      }

      lastRawText = text;

      try {
        parsed = extractJson(text);
        break; // success
      } catch (parseErr) {
        console.warn(`Attempt ${attempt}: failed to parse Gemini output as JSON.`, text);
        lastError = parseErr;
      }
    }

    if (!parsed) {
      console.error('All attempts failed. Last raw output:', lastRawText, lastError);
      return res
        .status(502)
        .json({ error: 'The LLM response could not be parsed after multiple attempts. Please try again.' });
    }

    const responseBody = {
      documentType: parsed.documentType || 'Unknown',
      title: parsed.title || 'Unknown',
      authors: parsed.authors || 'Unknown',
      summary: parsed.summary || 'No summary available.',
      keyTakeaway: parsed.keyTakeaway || 'No key takeaway available.',
    };

    analysisCache.set(pdfUrl, { result: responseBody, expiresAt: Date.now() + CACHE_TTL_MS });

    return res.status(200).json({ ...responseBody, cached: false });
  } catch (err) {
    console.error('Unhandled error in /api/analyze:', err);
    return res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});