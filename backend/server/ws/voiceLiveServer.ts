import {
  Modality,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
} from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyAuthToken, type AuthTokenPayload } from '../middleware/auth.js';
import { dbStore } from '../db/store.js';
import { getGeminiClient } from '../services/geminiService.js';

const LIVE_VOICE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'getMyScreeningSummary',
    description:
      'Fetch the authenticated patient latest preliminary oral screening report, risk category, image quality, and next steps.',
  },
  {
    name: 'getMyAppointments',
    description:
      'Fetch the authenticated user upcoming appointments, video call status, or urgent review requests.',
  },
  {
    name: 'findRegisteredHospitals',
    description:
      'Search verified registered hospitals and oral cancer specialists on Aarogya Drishti by city or name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        cityQuery: {
          type: Type.STRING,
          description: 'City or area name to filter hospitals (optional).',
        },
      },
    },
  },
];

const PUBLIC_LIVE_VOICE_TOOLS: FunctionDeclaration[] = [
  LIVE_VOICE_TOOLS[2],
];

function executeLiveVoiceTool(
  toolName: string | undefined,
  args: Record<string, unknown> | undefined,
  auth: AuthTokenPayload | null
): Record<string, unknown> {
  const state = dbStore.getState();

  if (toolName === 'getMyScreeningSummary') {
    if (!auth) {
      return {
        requiresSignIn: true,
        message: 'Please sign in with your mobile number and OTP to inspect personal screening reports.',
      };
    }
    if (auth.role !== 'patient' || !auth.patientId) {
      return {
        message: 'Screening history lookup is available for signed-in patient accounts.',
      };
    }
    const sessions = state.screenings
      .filter((s) => s.patientId === auth.patientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (sessions.length === 0) {
      return {
        totalScreenings: 0,
        message: 'You have not submitted a preliminary oral screening yet.',
      };
    }
    const latest = sessions[0];
    return {
      totalScreenings: sessions.length,
      latestReportCode: latest.reportCode,
      createdAt: latest.createdAt,
      status: latest.status,
      imageQuality: latest.aiReport?.imageQuality || 'pending',
      preliminaryRiskCategory: latest.aiReport?.preliminaryRiskCategory || 'pending',
      reportedOralRegion: latest.aiReport?.reportedOralRegion,
      urgencyOfAssessment: latest.aiReport?.urgencyOfAssessment,
      recommendedNextSteps: latest.aiReport?.recommendedNextSteps || [],
      emergencyGuidanceRequired: latest.aiReport?.emergencyGuidanceRequired || false,
    };
  }

  if (toolName === 'getMyAppointments') {
    if (!auth) {
      return {
        requiresSignIn: true,
        message: 'Please sign in with your mobile number and OTP to check personal appointments.',
      };
    }
    const relevant = state.appointments
      .filter((a) =>
        auth.role === 'patient'
          ? a.patientId === auth.patientId
          : auth.role === 'doctor'
          ? a.doctorId === auth.doctorId
          : auth.role === 'hospital_manager'
          ? a.hospitalId === auth.hospitalId
          : true
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5)
      .map((a) => {
        const hospital = state.hospitals.find((h) => h.id === a.hospitalId);
        const doctor = a.doctorId ? state.doctors.find((d) => d.id === a.doctorId) : null;
        return {
          appointmentCode: a.appointmentCode,
          date: a.date,
          timeSlot: a.timeSlot,
          type: a.type,
          mode: a.mode,
          status: a.status,
          hospitalName: hospital?.name || 'Registered Hospital',
          doctorName: doctor?.fullName || 'Assigned Specialist Pending',
        };
      });
    return {
      count: relevant.length,
      appointments: relevant,
    };
  }

  if (toolName === 'findRegisteredHospitals') {
    const q = typeof args?.cityQuery === 'string' ? args.cityQuery.trim().toLowerCase() : '';
    const hospitals = state.hospitals
      .filter((h) => h.active)
      .filter(
        (h) =>
          !q ||
          h.city.toLowerCase().includes(q) ||
          h.state.toLowerCase().includes(q) ||
          h.name.toLowerCase().includes(q)
      )
      .slice(0, 5)
      .map((h) => {
        const docs = state.doctors.filter(
          (d) => d.hospitalId === h.id && d.active && d.verificationStatus === 'verified'
        );
        return {
          name: h.name,
          city: h.city,
          state: h.state,
          phone: h.phone,
          workingHours: h.workingHours,
          verifiedDoctorsCount: docs.length,
          doctors: docs.slice(0, 3).map((d) => `${d.fullName} (${d.specialization}, Fee ₹${d.consultationFee})`),
        };
      });
    return {
      query: q || 'all',
      hospitals,
    };
  }

  return { error: `Unknown tool: ${toolName || 'unspecified'}` };
}

export function createVoiceLiveWss(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (clientWs: WebSocket, req) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const token = url.searchParams.get('token');
    const isPublicMode = !token && url.searchParams.get('mode') === 'public';

    let auth: AuthTokenPayload | null = null;
    let userName = 'Visitor';
    let userMobile: string | undefined;

    if (token) {
      try {
        auth = verifyAuthToken(token);
        const user = dbStore.getState().users.find((u) => u.id === auth!.userId);
        if (!user || !user.active) {
          clientWs.close(4003, 'Unauthorized');
          return;
        }
        userName = user.name;
        userMobile = user.mobile;
      } catch {
        clientWs.close(4002, 'Invalid token');
        return;
      }
    } else if (!isPublicMode) {
      clientWs.close(4001, 'Missing authentication token');
      return;
    }

    let session: Awaited<ReturnType<ReturnType<typeof getGeminiClient>['live']['connect']>> | null =
      null;
    let sessionPromise: Promise<
      Awaited<ReturnType<ReturnType<typeof getGeminiClient>['live']['connect']>>
    > | null = null;

    clientWs.on('message', (raw) => {
      if (!sessionPromise) return;
      let payload: { audio?: string; text?: string };
      try {
        payload = JSON.parse(raw.toString()) as { audio?: string; text?: string };
      } catch {
        return;
      }
      void sessionPromise
        .then((activeSession) => {
          if (payload.audio) {
            activeSession.sendRealtimeInput({
              audio: { data: payload.audio, mimeType: 'audio/pcm;rate=16000' },
            });
          } else if (payload.text) {
            activeSession.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: payload.text }] }],
              turnComplete: true,
            });
          }
        })
        .catch(() => {
          // handled by connect catch
        });
    });

    clientWs.on('close', () => {
      try {
        session?.close();
      } catch {
        // ignore close errors
      }
      session = null;
    });

    try {
      const ai = getGeminiClient();
      const phoneLabel = userMobile ? ` (Phone-verified: ${userMobile})` : '';
      const roleContext = !auth
        ? 'You are the Aarogya Drishti homepage AI Voice Guide welcoming a visitor before sign-in. Warmly explain how the 4-step oral health screening works (Phone + SMS/Gemini Voice OTP login, guided symptom & habit intake with Voice Auto-Fill, well-lit oral photo clarity + AI preliminary observations, and hospital discovery + WebRTC video consults). You can search verified registered hospitals and specialists using findRegisteredHospitals. Educate calmly on oral cancer risk factors (tobacco, gutka, areca/betel nut, alcohol, non-healing patches or ulcers lasting over 2 weeks). Remind visitors that AI triage never diagnoses or stages cancer and encourage signing in to start a private screening, or seeking emergency care for severe bleeding or breathing/swallowing difficulty.'
        : auth.role === 'doctor'
        ? 'You are assisting a qualified doctor using Aarogya Drishti. Help summarize oral screening triage workflows, appointment management, or documentation guidance concisely. You can check their appointments with getMyAppointments.'
        : 'You are the Aarogya Drishti oral health voice guide assisting a phone-verified patient. You can use tools to check their latest screening report (getMyScreeningSummary), upcoming appointments (getMyAppointments), or verified hospitals (findRegisteredHospitals). Also explain how the preliminary screening questionnaire works, how to take a clear well-lit intraoral photo, common oral cancer risk factors (tobacco, gutka, betel/areca nut, alcohol, non-healing ulcers > 2 weeks), and how to request urgent review. Always speak warmly, clearly, and concisely. NEVER claim to diagnose or stage cancer, and remind patients with severe bleeding or swallowing/breathing trouble to seek emergency care.';

      sessionPromise = ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
          tools: [
            {
              functionDeclarations: auth ? LIVE_VOICE_TOOLS : PUBLIC_LIVE_VOICE_TOOLS,
            },
          ],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `${roleContext} Automatically detect the language the user speaks or writes in on every turn. Reply aloud and in the transcript in the same language, using its natural form and script. If the user mixes languages, answer naturally in that mix; if they switch languages, follow their new language immediately. Support any language you can speak, not only Telugu, English, or Hindi. Never ask the user to select a language. The current user is ${userName}${phoneLabel}.`,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;

            // Execute live function calls against verified patient/doctor records
            if (message.toolCall?.functionCalls?.length && sessionPromise) {
              const calls = message.toolCall.functionCalls;
              void sessionPromise.then((activeSession) => {
                const responses = calls.map((call) => {
                  const output = executeLiveVoiceTool(
                    call.name,
                    call.args as Record<string, unknown> | undefined,
                    auth
                  );
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(
                      JSON.stringify({
                        type: 'tool-activity',
                        toolName: call.name,
                        text:
                          call.name === 'getMyScreeningSummary'
                            ? 'Checked your latest screening report'
                            : call.name === 'getMyAppointments'
                            ? 'Checked your scheduled appointments'
                            : 'Searched verified hospitals & specialists',
                      })
                    );
                  }
                  return {
                    id: call.id,
                    name: call.name,
                    response: { output },
                  };
                });
                activeSession.sendToolResponse({ functionResponses: responses });
              });
            }

            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(
                JSON.stringify({
                  type: 'input-transcript',
                  text: content.inputTranscription.text,
                })
              );
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({
                  type: 'output-transcript',
                  text: content.outputTranscription.text,
                })
              );
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(
                  JSON.stringify({
                    type: 'audio',
                    audio: part.inlineData.data,
                  })
                );
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ type: 'interrupted' }));
            }
            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ type: 'turn-complete' }));
            }
          },
          onerror: (err: unknown) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  type: 'voice-error',
                  error:
                    err instanceof Error
                      ? err.message
                      : 'Voice session encountered an error.',
                })
              );
            }
          },
          onclose: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close();
            }
          },
        },
      });

      session = await sessionPromise;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: 'voice-ready',
            verifiedPhone: userMobile || null,
          })
        );
      }
    } catch (err) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: 'voice-error',
            error:
              err instanceof Error
                ? err.message
                : 'Unable to connect to Gemini Live Voice Assistant.',
          })
        );
        clientWs.close();
      }
      return;
    }
  });

  return wss;
}
