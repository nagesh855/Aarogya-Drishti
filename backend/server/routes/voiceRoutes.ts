import { Router } from 'express';
import multer from 'multer';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  extractSymptomsFromVoiceWithGemini,
  isGeminiConfigured,
  synthesizeSpeechWithGemini,
  transcribeAudioWithGemini,
} from '../services/geminiService.js';
import { sanitizeString } from '../db/store.js';

export const voiceRouter = Router();

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

voiceRouter.get('/status', authenticate, (_req, res) => {
  res.json({
    voiceAssistantAvailable: isGeminiConfigured(),
    models: {
      liveVoice: 'gemini-3.8-live',
      tts: 'gemini-3.8-flash-lite-tts',
      transcription: 'gemini-3.5-transcribe',
    },
  });
});

// Read out screening reports or clinical notes using Gemini TTS
voiceRouter.post('/tts', authenticate, async (req: AuthenticatedRequest, res) => {
  const text = sanitizeString(req.body?.text, 3000);
  const voiceName = req.body?.voiceName;
  const allowedVoices = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);
  const chosenVoice = allowedVoices.has(voiceName) ? voiceName : 'Kore';

  if (!text) {
    res.status(400).json({ error: 'Text content is required for speech synthesis.' });
    return;
  }

  try {
    const result = await synthesizeSpeechWithGemini(text, chosenVoice);
    res.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unable to generate spoken audio.';
    res.status(502).json({ error: message });
  }
});

// Transcribe recorded patient symptom description or doctor clinical dictation
voiceRouter.post(
  '/transcribe',
  authenticate,
  audioUpload.single('audio'),
  async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Please provide a recorded audio clip.' });
      return;
    }

    const contextHint = sanitizeString(req.body?.contextHint, 300);
    try {
      const base64Audio = req.file.buffer.toString('base64');
      const mimeType = req.file.mimetype || 'audio/webm';
      const transcript = await transcribeAudioWithGemini(
        base64Audio,
        mimeType,
        contextHint || undefined
      );
      res.json({ transcript });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to transcribe audio recording.';
      res.status(502).json({ error: message });
    }
  }
);

// Voice Auto-Fill Symptom Intake: Transcribe speech & extract structured questionnaire fields
voiceRouter.post(
  '/intake-extract',
  authenticate,
  audioUpload.single('audio'),
  async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Please record your symptoms to auto-fill.' });
      return;
    }

    try {
      const base64Audio = req.file.buffer.toString('base64');
      const mimeType = req.file.mimetype || 'audio/webm';
      const result = await extractSymptomsFromVoiceWithGemini(base64Audio, mimeType);
      res.json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to process voice intake recording.';
      res.status(502).json({ error: message });
    }
  }
);
