import { jsonrepair } from "jsonrepair";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";

const GEMINI_TIMEOUT_MS = 120_000;

const ANALYSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    documentType: { type: "STRING" },
    title: { type: "STRING" },
    authors: { type: "STRING" },
    summary: { type: "STRING" },
    keyTakeaway: { type: "STRING" },
  },
  required: [
    "documentType",
    "title",
    "authors",
    "summary",
    "keyTakeaway",
  ],
};

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(jsonrepair(candidate));
  }
}

async function callGemini(geminiUrl, prompt, base64Pdf) {
  const geminiResponse = await fetchWithTimeout(
    geminiUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: base64Pdf,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_SCHEMA,
        },
      }),
    },
    GEMINI_TIMEOUT_MS
  );

  if (!geminiResponse.ok) {
    const errorBody = await geminiResponse.text().catch(() => "");

    const err = new Error("Gemini API call failed");
    err.status = geminiResponse.status;
    err.body = errorBody;
    throw err;
  }

  const geminiJson = await geminiResponse.json();

  const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    const err = new Error("Unexpected Gemini response shape");
    err.raw = geminiJson;
    throw err;
  }

return extractJson(text);
}

export { callGemini };