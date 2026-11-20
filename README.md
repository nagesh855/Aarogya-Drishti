<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/e22e1bcd-7e1a-4d6f-979f-28114406eb8e

## Run Locally

**Prerequisites:**  Node.js

### Project folders

- `frontend/` contains the React application, Vite entry page, and public assets.
- `backend/` contains the Express server entry point and API, database, and WebSocket modules.
- `shared/` contains types and utilities used by both frontend and backend.
- Root package scripts coordinate development and production builds; run them from the project root.

1. Install dependencies:
   `npm install`
2. Create a `.env.local` file in the project root and add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   ```
   Keep this key private. For hosted deployments, configure `GEMINI_API_KEY` in the deployment platform's environment variables/secrets.
3. Run the app:
   `npm run dev`

## Languages

Use the language selector beside **AI Voice Guide** to switch between Telugu, English, and Hindi. The selection is saved in the browser and applies across the public site and role portals. The AI Voice Guide follows the selected language; patient-provided and clinical record text is kept as entered rather than automatically rewritten.

In the patient screening questionnaire, symptoms are captured as a free-text description rather than a checklist. The **Dictate** control shows live speech recognition in supported browsers and uses record-then-transcribe as a fallback.

## ASHA Worker Follow-up

Hospital Managers can create ASHA Worker accounts from **ASHA Workers**, assigning each account to one village. Share the generated worker ID and temporary password securely; the worker must change the password at first sign-in.

Patients can set their village and optionally consent to village follow-up in **Personal Profile**. Consenting patients appear only to active ASHA Workers assigned to that village. Workers can review basic screening/appointment status and record education, referral, or follow-up notes; they cannot diagnose or prescribe treatment. Follow-up updates are sent to the patient dashboard in real time.
