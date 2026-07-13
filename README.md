# AI PDF Analyzer

AI PDF Analyzer is a web application that analyzes publicly accessible PDF documents using Google's Gemini API. Users can provide a PDF URL and receive a structured analysis containing the document type, title, authors, summary, and key takeaway.

---

## 🚀 Live Demo

**Application:**  
https://ai-pdf-analyzer-frontend-swart.vercel.app

---

## ✨ Features

- Analyze publicly accessible PDF documents
- Secure server-side Gemini API integration
- Structured document analysis
- PDF validation before processing
- Request timeout handling
- Automatic retry for temporary AI failures
- In-memory caching
- User-friendly error handling

---

## 🛠️ Tech Stack

### Frontend
- React (Vite)
- JavaScript
- CSS

### Backend
- Node.js
- Express.js

### AI
- Google Gemini API

### Deployment
- Vercel (Frontend)
- Railway (Backend)

---

## 📁 Project Structure

```text
AI-Pdf-Analyzer/
│
├── backend/
│   ├── routes/
│   ├── services/
│   ├── utils/
│   ├── lib/
│   └── server.js
│
├── frontend/
│   ├── src/
│   ├── public/
│   └── vite.config.js
│
└── README.md
```

---

## ⚙️ How It Works

1. Enter a public PDF URL.
2. The frontend sends the request to the Express backend.
3. The backend validates and downloads the PDF.
4. Gemini analyzes the PDF.
5. The structured analysis is returned and displayed on the frontend.

---

## 💻 Run Locally

### Backend

```bash
cd backend
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## 🎯 Design Decisions

- Gemini API is called only from the backend to keep the API key secure.
- PDF validation prevents invalid files from being processed.
- Timeout handling avoids hanging requests.
- Retry logic handles temporary Gemini API failures.
- Caching improves performance for repeated requests.

---

## 🔮 Future Improvements

- Redis caching
- Rate limiting
- Virus scanning
- Authentication
- Database support

---

## 👩‍💻 Author

**Sakshi Navnath Ghorpade**

GitHub: https://github.com/SGhorpad