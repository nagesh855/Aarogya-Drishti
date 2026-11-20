import { GoogleGenAI, Type } from '@google/genai';
import type {
  AIScreeningReport,
  ScreeningQuestionnaire,
} from '../../../shared/types/index.js';

const MODEL_NAME = 'gemini-4-hydrogen';

export function getGeminiClient(apiVersion: 'v1beta' | 'v1alpha' = 'v1beta'): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please configure GEMINI_API_KEY in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
}

export async function synthesizeSpeechWithGemini(
  text: string,
  voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' = 'Kore',
  style = 'Calm, compassionate healthcare educator speaking clearly and reassuringly'
): Promise<{ audioBase64: string; mimeType: string }> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text,
            speechMetadata: {
              style,
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const part = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!part?.data) {
    throw new Error('Speech synthesis did not return audio data.');
  }
  return {
    audioBase64: part.data,
    mimeType: part.mimeType || 'audio/wav',
  };
}

export async function transcribeAudioWithGemini(
  base64Audio: string,
  mimeType: string,
  contextHint?: string
): Promise<string> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType,
            data: base64Audio,
          },
        },
        {
          text:
            contextHint ||
            'Transcribe this healthcare audio accurately into clean plain text.',
        },
      ],
    },
  });
  return (response.text ?? '').trim();
}

export interface VoiceExtractedQuestionnaire {
  age?: number;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  generalLocation?: string;
  usesTobacco?: 'yes' | 'no' | 'unsure';
  tobaccoTypes?: string[];
  tobaccoFrequencyDuration?: string;
  consumesAlcohol?: 'yes' | 'no' | 'occasionally' | 'unsure';
  chewsBetelOrArecaNut?: 'yes' | 'no' | 'unsure';
  betelFrequencyDuration?: string;
  symptoms?: Partial<ScreeningQuestionnaire['symptoms']>;
  symptomDuration?: string;
  otherSymptomsDescription?: string;
  severeOrRapidlyWorsening?: boolean;
  detectedHighlights: string[];
}

export async function extractSymptomsFromVoiceWithGemini(
  base64Audio: string,
  mimeType: string
): Promise<{ transcript: string; extractedFields: VoiceExtractedQuestionnaire }> {
  const transcript = await transcribeAudioWithGemini(
    base64Audio,
    mimeType,
    'Transcribe a patient describing their age, city/location, tobacco/gutka/betel nut/alcohol habits, and oral health symptoms accurately.'
  );

  if (!transcript) {
    return {
      transcript: '',
      extractedFields: { detectedHighlights: [] },
    };
  }

  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Extract only facts explicitly stated by the patient in this transcript into structured oral screening questionnaire fields. Do not invent or assume unmentioned symptoms.\n\nTranscript:\n"${transcript}"`,
    config: {
      systemInstruction:
        'You map patient speech transcripts into structured oral health screening form fields accurately. Only set boolean symptom flags to true if the patient explicitly mentioned them. Use symptomDuration values matching: "Less than one week", "1–2 weeks", "2–4 weeks", "1–3 months", or "More than 3 months".',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          age: { type: Type.INTEGER },
          gender: { type: Type.STRING },
          generalLocation: { type: Type.STRING },
          usesTobacco: { type: Type.STRING },
          tobaccoTypes: { type: Type.ARRAY, items: { type: Type.STRING } },
          tobaccoFrequencyDuration: { type: Type.STRING },
          consumesAlcohol: { type: Type.STRING },
          chewsBetelOrArecaNut: { type: Type.STRING },
          betelFrequencyDuration: { type: Type.STRING },
          symptomDuration: { type: Type.STRING },
          otherSymptomsDescription: { type: Type.STRING },
          severeOrRapidlyWorsening: { type: Type.BOOLEAN },
          symptoms: {
            type: Type.OBJECT,
            properties: {
              whitePatches: { type: Type.BOOLEAN },
              redPatches: { type: Type.BOOLEAN },
              nonHealingUlcers: { type: Type.BOOLEAN },
              unusualGrowthsOrLumps: { type: Type.BOOLEAN },
              difficultyOpeningMouth: { type: Type.BOOLEAN },
              difficultySwallowing: { type: Type.BOOLEAN },
              painWhileChewing: { type: Type.BOOLEAN },
              bleedingInsideMouth: { type: Type.BOOLEAN },
              persistentPainOrNumbness: { type: Type.BOOLEAN },
              voiceChangeOrNeckSwelling: { type: Type.BOOLEAN },
            },
          },
          detectedHighlights: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Short human-readable summary phrases of what fields were detected.',
          },
        },
        required: ['detectedHighlights'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as VoiceExtractedQuestionnaire;
  return {
    transcript,
    extractedFields: {
      ...parsed,
      detectedHighlights: Array.isArray(parsed.detectedHighlights)
        ? parsed.detectedHighlights
        : [],
    },
  };
}

export interface OralImageInput {
  mimeType: string;
  base64Data: string;
  oralRegion: string;
}

export async function analyzeOralScreeningWithGemini(
  images: OralImageInput[],
  questionnaire: ScreeningQuestionnaire
): Promise<AIScreeningReport> {
  const ai = getGeminiClient();

  const activeSymptoms = Object.entries(questionnaire.symptoms)
    .filter(([, present]) => present)
    .map(([key]) => key.replace(/([A-Z])/g, ' $1').toLowerCase().trim());

  const promptText = `
Evaluate the provided oral cavity photograph(s) together with the patient's questionnaire data to produce a structured preliminary oral health screening report.

Patient Questionnaire Context:
- Age: ${questionnaire.age ?? 'Not provided'}
- Gender: ${questionnaire.gender || 'Not provided'}
- Previous oral health problems: ${questionnaire.previousOralProblems || 'None reported'}
- Tobacco use: ${questionnaire.usesTobacco}${
    questionnaire.usesTobacco === 'yes'
      ? ` (Types: ${questionnaire.tobaccoTypes.join(', ') || 'unspecified'}; Duration/Freq: ${questionnaire.tobaccoFrequencyDuration || 'unspecified'})`
      : ''
  }
- Alcohol consumption: ${questionnaire.consumesAlcohol}${
    questionnaire.alcoholFrequencyDuration ? ` (${questionnaire.alcoholFrequencyDuration})` : ''
  }
- Betel nut / areca nut chewing: ${questionnaire.chewsBetelOrArecaNut}${
    questionnaire.betelFrequencyDuration ? ` (${questionnaire.betelFrequencyDuration})` : ''
  }
- Reported oral regions photographed: ${images.map((img) => img.oralRegion).join(', ')}
- Structured symptoms reported: ${activeSymptoms.length > 0 ? activeSymptoms.join('; ') : 'Not selected'}
- Patient-described symptoms (consider this text when triaging): ${questionnaire.otherSymptomsDescription || 'Not reported'}
- Symptom duration: ${questionnaire.symptomDuration || 'Not specified'}
- Severe or rapidly worsening symptoms reported: ${questionnaire.severeOrRapidlyWorsening ? 'YES' : 'No'}
- Additional patient description: ${questionnaire.otherSymptomsDescription || 'None'}

Strict Clinical Safety Rules:
1. First assess image quality ('adequate', 'inadequate', or 'uncertain'). If the photo is blurry, too dark, out of focus, obstructed, or not clearly showing an oral cavity region, mark imageQuality as 'inadequate' and explain clearly what needs to be retaken.
2. Describe visible features neutrally (e.g., white plaque/patch, erythematous/red area, ulcerative lesion, mucosal swelling, normal-appearing mucosa) without asserting a confirmed diagnosis.
3. NEVER claim that the photograph proves cancer, NEVER assign a cancer stage (no Stage I/II/III/IV), and NEVER replace a clinical examination or biopsy.
4. Assign one preliminary triage category: 'Low Risk', 'Moderate Risk', 'High Risk', or 'Urgent Clinical Evaluation Recommended'.
   - Consider the patient's own symptom description, visible mucosal findings, AND questionnaire risk factors (long-duration non-healing ulcers > 2 weeks, red/white patches, difficulty swallowing/opening mouth, neck swelling, combined tobacco/betel nut habits).
   - If severe or rapidly worsening symptoms are reported, set emergencyGuidanceRequired to true.
5. Write in clear, supportive, plain language for the patient, with an explicit uncertainty and limitations statement.
`.trim();

  const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];
  for (const img of images) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64Data,
      },
    });
  }
  parts.push({ text: promptText });

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: { parts },
    config: {
      systemInstruction:
        'You are a careful oral health triage assistant supporting Aarogya Drishti. You provide neutral visible observations and preliminary risk categorization to help patients decide when to seek qualified dental, ENT, or oral medicine evaluation. You never diagnose cancer, never assign cancer stages, and always emphasize clinical validation and biopsy/examination when indicated.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          imageQuality: {
            type: Type.STRING,
            description: 'Must be one of: adequate, inadequate, uncertain',
          },
          imageQualityReason: {
            type: Type.STRING,
            description: 'Brief explanation of lighting, focus, and visibility.',
          },
          observedVisibleFeatures: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Neutral descriptions of visible mucosal/oral features.',
          },
          reportedOralRegion: {
            type: Type.STRING,
          },
          preliminaryRiskCategory: {
            type: Type.STRING,
            description:
              'Must be one of: Low Risk, Moderate Risk, High Risk, Urgent Clinical Evaluation Recommended',
          },
          riskExplanation: {
            type: Type.STRING,
          },
          patientReportedSymptomsSummary: {
            type: Type.STRING,
          },
          lifestyleRiskFactorsSummary: {
            type: Type.STRING,
          },
          recommendedNextSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          urgencyOfAssessment: {
            type: Type.STRING,
          },
          uncertaintyAndLimitations: {
            type: Type.STRING,
          },
          emergencyGuidanceRequired: {
            type: Type.BOOLEAN,
          },
        },
        required: [
          'imageQuality',
          'imageQualityReason',
          'observedVisibleFeatures',
          'reportedOralRegion',
          'preliminaryRiskCategory',
          'riskExplanation',
          'patientReportedSymptomsSummary',
          'lifestyleRiskFactorsSummary',
          'recommendedNextSteps',
          'urgencyOfAssessment',
          'uncertaintyAndLimitations',
          'emergencyGuidanceRequired',
        ],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as Omit<AIScreeningReport, 'modelUsed' | 'generatedAt'>;

  const validRiskCategories = new Set([
    'Low Risk',
    'Moderate Risk',
    'High Risk',
    'Urgent Clinical Evaluation Recommended',
  ]);
  const validQualities = new Set(['adequate', 'inadequate', 'uncertain']);

  const normalizedQuality = validQualities.has(parsed.imageQuality)
    ? parsed.imageQuality
    : 'uncertain';

  let normalizedCategory = validRiskCategories.has(parsed.preliminaryRiskCategory)
    ? parsed.preliminaryRiskCategory
    : 'Moderate Risk';

  // Safety rule: Do not make urgent care dependent solely on AI score
  const emergencyRequired =
    Boolean(parsed.emergencyGuidanceRequired) ||
    Boolean(questionnaire.severeOrRapidlyWorsening) ||
    normalizedCategory === 'Urgent Clinical Evaluation Recommended';

  if (questionnaire.severeOrRapidlyWorsening && normalizedCategory === 'Low Risk') {
    normalizedCategory = 'Urgent Clinical Evaluation Recommended';
  }

  return {
    ...parsed,
    imageQuality: normalizedQuality,
    preliminaryRiskCategory: normalizedCategory,
    emergencyGuidanceRequired: emergencyRequired,
    modelUsed: MODEL_NAME,
    generatedAt: new Date().toISOString(),
  };
}
