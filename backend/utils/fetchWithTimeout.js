export async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 20000
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`);
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }

    throw err;
  } finally {
    clearTimeout(timer);
  }
}