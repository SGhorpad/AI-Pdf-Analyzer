import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import analyzeRouter from './routes/analyze.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Allow the frontend's origin. In dev this is Vite's default port.
// In production, set FRONTEND_ORIGIN to your deployed frontend URL.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());

// All routes defined in routes/analyze.js are mounted under /api,
// so POST /analyze in that file becomes POST /api/analyze here.
app.use('/api', analyzeRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});