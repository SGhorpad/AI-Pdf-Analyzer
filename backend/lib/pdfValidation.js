function normalizePdfUrl(input) {
  return typeof input === "string" ? input.trim() : "";
}

export function validatePdfUrl(input) {
  const normalized = normalizePdfUrl(input);

  if (!normalized) {
    return { ok: false, error: "Please provide a PDF URL." };
  }

  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        ok: false,
        error: "Please provide a valid, publicly accessible PDF URL.",
      };
    }

    return { ok: true, normalizedUrl: normalized };
  } catch {
    return {
      ok: false,
      error: "Please provide a valid, publicly accessible PDF URL.",
    };
  }
}

export function validatePdfContent(buffer, contentType = "", pdfUrl = "") {
  if (!buffer || buffer.byteLength === 0) {
    return { ok: false, error: "The URL returned an empty file." };
  }

  if (buffer.byteLength > 15 * 1024 * 1024) {
    return {
      ok: false,
      error: "The PDF is too large to analyse (limit is 15 MB).",
    };
  }

  const sample = Buffer.from(buffer.subarray(0, 256)).toString("latin1");
  const looksLikePdfSignature = sample.startsWith("%PDF-");
  const looksLikeHtml = /<!doctype html|<html|<body|<script/i.test(sample);

  if (!looksLikePdfSignature || looksLikeHtml) {
    return {
      ok: false,
      error: "The URL does not appear to point to a valid PDF file.",
    };
  }

  const hasPdfMime = /application\/pdf/i.test(contentType || "");
  const hasPdfExtension = /\.pdf(?:$|[?#])/i.test(pdfUrl || "");

  if (contentType && !hasPdfMime && !hasPdfExtension) {
    return {
      ok: false,
      error: "That URL does not appear to point to a PDF file.",
    };
  }

  return { ok: true };
}