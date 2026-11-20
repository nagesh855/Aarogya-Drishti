<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Aarogya Drishti

The frontend and backend are independent npm packages in `frontend/` and `backend/`. Shared application types and utilities are in `shared/`.

View your app in AI Studio: https://ai.studio/apps/e22e1bcd-7e1a-4d6f-979f-28114406eb8e

## Run Locally

**Prerequisites:**  Node.js

Install and run each package in a separate terminal:

1. Backend terminal:
   ```powershell
   cd backend
   npm install
   Copy-Item .env.example .env.local
   npm run dev
   ```
   The API listens on `http://localhost:3001`.
2. Frontend terminal:
   ```powershell
   cd frontend
   npm install
   npm run dev
   ```
   Open `http://localhost:3000`. Vite proxies API and WebSocket requests to the backend.

The backend reads configuration from `backend/.env.local`. Set the Gemini API key there:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   ```
   Keep this key private. For hosted deployments, configure `GEMINI_API_KEY` in the deployment platform's environment variables/secrets.

Build the frontend independently with `cd frontend; npm run build`. Type-check either package with `npm run typecheck` from its folder.

## Deploy to Render

This repository includes `render.yaml` for a single Render Web Service. Create or update the service using the Blueprint, and keep its Root Directory empty (the repository root). The build installs and builds `frontend/` and installs `backend/` independently; the backend serves the compiled frontend and API on the same origin.

If configuring an existing service manually, use:

- **Build Command:** `npm ci --prefix frontend && npm run build --prefix frontend && npm ci --prefix backend --include=dev`
- **Start Command:** `npm start --prefix backend`
- **Health Check Path:** `/api/health`

Set `GEMINI_API_KEY`, `MONGODB_URI`, and a strong `JWT_SECRET` in the Render environment. Configure MongoDB for persistent application data; Render's local filesystem is ephemeral unless a persistent disk is attached.

## Languages

Use the language selector beside **AI Voice Guide** to switch between Telugu, English, and Hindi. The selection is saved in the browser and applies across the public site and role portals. The AI Voice Guide follows the selected language; patient-provided and clinical record text is kept as entered rather than automatically rewritten.

In the patient screening questionnaire, symptoms are captured as a free-text description rather than a checklist. The **Dictate** control shows live speech recognition in supported browsers and uses record-then-transcribe as a fallback.

## ASHA Worker Follow-up

Hospital Managers can create ASHA Worker accounts from **ASHA Workers**, assigning each account to one village. Share the generated worker ID and temporary password securely; the worker must change the password at first sign-in.

Patients can set their village and optionally consent to village follow-up in **Personal Profile**. Consenting patients appear only to active ASHA Workers assigned to that village. Workers can review basic screening/appointment status and record education, referral, or follow-up notes; they cannot diagnose or prescribe treatment. Follow-up updates are sent to the patient dashboard in real time.
