# OverLeafAI

Real-time math editor with natural language input, AI-powered LaTeX conversion, and synchronized preview panes.

## Tech Stack

- **Frontend:** React + Vite, custom prose editor surface, MathJax (via `better-react-mathjax`), Tailwind-inspired custom styling, Axios
- **Backend:** Node.js, Express, Axios, OpenAI GPT-4/4o API
- **Deployment targets:** Vercel (frontend) and Render/Railway/Heroku (backend)

## Features

- Type plain-English or shorthand math on the left pane and watch MathJax render the LaTeX preview on the right.
- Automatic LaTeX conversion through the `/convert` endpoint (GPT powered) with a graceful offline fallback.
- Toggleable synchronous scrolling keeps both panes aligned for long documents.
- Health endpoint (`/health`) plus helpful loading/error indicators in the UI.

### Usage tip

Wrap math or formatting instructions between `*asterisks*` so the AI knows exactly what to convert.
Anything outside the asterisks is treated as commentary and shows beneath the rendered equation.

## Getting Started

### Backend

```bash
cd backend
cp .env.example .env   # add your OPENAI_API_KEY
npm install
npm run dev            # starts http://localhost:4000
```

Environment variables:

- `OPENAI_API_KEY` - required for real OpenAI responses.
- `OPENAI_MODEL` - optional (defaults to `gpt-4o-mini`).
- `PORT` - defaults to `4000`.

> Without an API key the server falls back to a basic converter so the UI still functions for demos.

### Frontend

```bash
cd frontend
cp .env.example .env   # optional: point to a remote API
npm install
npm run dev            # starts Vite dev server
```

- `VITE_API_BASE_URL` defaults to `http://localhost:4000`.
- Build for production with `npm run build`. Deploy the `dist/` folder to Vercel/Netlify.

## API Contract

`POST /convert`

```json
{ "input": "squareroot(2x) + integral(0, pi, sin(x) dx)" }
```

Response:

```json
{
  "segments": [
    { "type": "latex", "content": "\\sqrt{2x}" },
    { "type": "text", "content": "surface explanation" },
    { "type": "latex", "content": "\\int_{0}^{\\pi} \\sin(x)\\,dx" }
  ]
}
```

## Deployment Notes

1. Deploy `backend/` to Render/Railway/Heroku. Remember to set `OPENAI_API_KEY`, `OPENAI_MODEL`, and `PORT` (if required by the platform).
2. Deploy `frontend/` to Vercel/Netlify. Set `VITE_API_BASE_URL` to the deployed backend URL.
3. Enable CORS on the backend (already configured) so the frontend can call it from the deployed origin.

Enjoy building with OverLeafAI!
