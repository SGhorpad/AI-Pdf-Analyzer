import { useEffect, useState } from "react";

const EXAMPLE_URL = "https://arxiv.org/pdf/1706.03762";
const ANALYSE_PATH = "/api/analyse";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";



function readStoredResult() {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.sessionStorage.getItem("lastAnalysisResult");
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [pdfUrl, setPdfUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isAnalyseRoute, setIsAnalyseRoute] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.location.pathname === ANALYSE_PATH;
  });


  //sync route with browser history
  useEffect(() => {
    const syncRoute = () => {
      setIsAnalyseRoute(window.location.pathname === ANALYSE_PATH);
    };

    syncRoute();
    window.addEventListener("popstate", syncRoute);

    return () => window.removeEventListener("popstate", syncRoute);
  }, []);


  //load stored result if user refreshes page on analyse route
  useEffect(() => {
    if (isAnalyseRoute && !result) {
      const storedResult = readStoredResult();
      if (storedResult) {
        setResult(storedResult);
      }
    }
  }, [isAnalyseRoute, result]);



  //after clicking analyze button 
  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setCopied(false);

    const normalizedUrl = pdfUrl.trim();

    if (!normalizedUrl) {
      setError("Please paste a PDF URL first.");
      return;
    }

    try {
      const parsed = new URL(normalizedUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        setError("Please provide a valid public PDF URL.");
        return;
      }
    } catch {
      setError("Please provide a valid public PDF URL.");
      return;
    }


    //user is on analyse path
    window.history.pushState({}, "", ANALYSE_PATH);
    setIsAnalyseRoute(true);
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfUrl: normalizedUrl }),
      });

      let data;

      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      setResult(data);
      window.sessionStorage.setItem("lastAnalysisResult", JSON.stringify(data));
    } catch {
      setError("Network error — could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  //handle copy
  function handleCopy() {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  //for new request it erase prev result info
  function handleNewAnalysis() {
    setPdfUrl("");
    setResult(null);
    setError(null);
    setCopied(false);

    sessionStorage.removeItem("lastAnalysisResult");

    window.history.pushState({}, "", "/");
    setIsAnalyseRoute(false);
  }
  const showResult = isAnalyseRoute && result && !loading;

  return (
    <main className="page">
      <div className="frame">
        <div className="titlebar">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
          <span className="titlebar-label">AI Pdf-Analzer</span>
        </div>

        <div className="body">
          <p className="eyebrow">Document intake</p>
          <h1>AI PDF Analyzer</h1>
          <p className="subtitle">
            Paste a publicly accessible PDF URL. It's read server-side and
            returned as a structured analysis — document type, title, authors,
            summary, and the single most important takeaway.
          </p>

          <form onSubmit={handleSubmit} className="form-row">
            <div className="input-wrap">
              <input
                type="url"
                required
                value={pdfUrl}
                onChange={(e) => setPdfUrl(e.target.value)}
                placeholder={EXAMPLE_URL}
                disabled={loading}
              />
            </div>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? "Analyzing PDF..." : "🔍 Analyze"}
            </button>
          </form>

          <button
            type="button"
            className="example-link"
            onClick={() => setPdfUrl(EXAMPLE_URL)}
            disabled={loading}
          >
            📄 Try Sample PDF
          </button>

          {error && (
            <div className="error-box">
              <span className="mark">!</span>
              <span>{error}</span>
            </div>
          )}

          {/* loading state when user clicks analyze button and waiting for response */}
          {loading && (
            <div className="scan-box">
              <div className="doc-silhouette">
                <span className="line" />
                <span className="line" />
                <span className="line" />
                <span className="line" />
                <span className="line" />
                <span className="beam" />
              </div>
              <div className="scan-text">
                Loading document...
                <br />
                Analyzing content...
                <br />
                Generating AI insights...
                <span className="cursor" />
              </div>
            </div>
          )}

          {/* show result when user gets response from server */}
          {showResult && (
            <div className="result-box">
              <div className="result-head">
                <span className="result-head-label">Analysis Result</span>

                {/* buttons for new analysis and copy json */}
                <div className="result-actions">
                  <button
                    className="new-btn"
                    onClick={handleNewAnalysis}
                    type="button"
                  >
                    ← New Analysis
                  </button>

                  <button
                    className="copy-btn"
                    onClick={handleCopy}
                    type="button"
                  >
                    {copied ? "Copied" : "Copy JSON"}
                  </button>
                </div>
              </div>

              <div className="field">
                <div className="field-label">Doc type</div>
                <div className="field-value tag">{result.documentType}</div>
              </div>
              <div className="field">
                <div className="field-label">Title</div>
                <div className="field-value">{result.title}</div>
              </div>
              <div className="field">
                <div className="field-label">Authors</div>
                <div className="field-value">{result.authors}</div>
              </div>
              <div className="field">
                <div className="field-label">Summary</div>
                <div className="field-value">{result.summary}</div>
              </div>
              <div className="field">
                <div className="field-label">Key takeaway</div>
                <div className="field-value highlight">
                  {result.keyTakeaway}
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="footer">
          AI PDF Analyzer • React • Express • Gemini API
        </footer>
      </div>
    </main>
  );
}