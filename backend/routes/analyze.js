import express from "express";
import { callGemini } from "../services/geminiService.js";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";
import {
    validatePdfUrl,
    validatePdfContent,
} from "../lib/pdfValidation.js";

const router = express.Router();

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB safety cap
const FETCH_TIMEOUT_MS = 20_000; // fail fast instead of hanging on a slow host


const analysisCache = new Map(); // url -> { result, expiresAt }
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour




//analyze func
router.post('/analyze', async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({
                error:
                    'Server is missing GEMINI_API_KEY. Add it to your environment variables and restart.',
            });
        }

        const pdfUrl = req.body?.pdfUrl;

        const urlValidation = validatePdfUrl(pdfUrl);

        if (!urlValidation.ok) {
            return res.status(400).json({
                error: urlValidation.error,
            });
        }

        const normalizedPdfUrl = urlValidation.normalizedUrl;
        // 0. Serve from cache if we've already analysed this exact URL recently.
        const cached = analysisCache.get(normalizedPdfUrl);
        if (cached && cached.expiresAt > Date.now()) {
            return res.status(200).json({ ...cached.result, cached: true });
        }

        // 1. Fetch the PDF server-side.
        let pdfResponse;
        try {
            pdfResponse = await fetchWithTimeout(
                normalizedPdfUrl,
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


        const declaredLength = Number(pdfResponse.headers.get('content-length') || 0);
        if (declaredLength > MAX_PDF_BYTES) {
            return res
                .status(400)
                .json({ error: 'The PDF is too large to analyse (limit is 15 MB).' });
        }

        const contentType = pdfResponse.headers.get('content-type') || '';
        const buffer = Buffer.from(await pdfResponse.arrayBuffer());

        const contentValidation = validatePdfContent(
            buffer,
            contentType,
            normalizedPdfUrl
        );

        if (!contentValidation.ok) {
            return res.status(400).json({
                error: contentValidation.error,
            });
        }
        const base64Pdf = buffer.toString("base64");

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
        let lastError;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const prompt =
                    attempt === 1
                        ? basePrompt
                        : `${basePrompt}\n\nIMPORTANT: A previous attempt returned malformed JSON with duplicated sentences. Return clean, valid, non-duplicated JSON this time.`;

                parsed = await callGemini(geminiUrl, prompt, base64Pdf);
                break;
            } catch (err) {
                if (err.status === 429) {
                    return res.status(429).json({
                        error:
                            "You've hit the Gemini free-tier rate limit. Please wait a minute and try again.",
                    });
                }

                if (err.status === 503) {
                    return res.status(503).json({
                        error:
                            "Gemini is currently experiencing high demand. Please try again in a few moments.",
                    });
                }

                if (err.isTimeout) {
                    console.error("Gemini call timed out on attempt", attempt);
                    lastError = err;
                    continue;
                }

                console.error("Gemini API error:", err.status || "", err.body || err.message);
                lastError = err;
            }
        }

        if (!parsed) {
            console.error('All attempts failed.', lastError);
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

        analysisCache.set(normalizedPdfUrl, { result: responseBody, expiresAt: Date.now() + CACHE_TTL_MS });

        return res.status(200).json({ ...responseBody, cached: false });
    } catch (err) {
        console.error('Unhandled error in /api/analyze:', err);
        return res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
    }
});

export default router;