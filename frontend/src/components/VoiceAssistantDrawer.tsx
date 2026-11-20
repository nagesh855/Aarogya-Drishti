import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Mic, MicOff, PhoneOff, Send, Volume2, X } from 'lucide-react';
import { getStoredToken } from '../utils/api.js';
import type { UserRole } from '../../../shared/types/index.js';

interface VoiceAssistantDrawerProps {
  open: boolean;
  userRole?: UserRole;
  publicMode?: boolean;
  initialPrompt?: string | null;
  onSignInRequest?: () => void;
  onClose: () => void;
}

interface TranscriptEntry {
  id: string;
  speaker: 'you' | 'assistant' | 'system';
  text: string;
}

function floatTo16BitPcmBase64(float32Array: Float32Array): string {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const byteLength = binary.length;
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export function VoiceAssistantDrawer({
  open,
  userRole = 'patient',
  publicMode = false,
  initialPrompt = null,
  onSignInRequest,
  onClose,
}: VoiceAssistantDrawerProps) {
  const [sessionState, setSessionState] = useState<'idle' | 'connecting' | 'live' | 'error'>(
    'idle'
  );
  const [micMuted, setMicMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [textQuestion, setTextQuestion] = useState('');
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const mutedRef = useRef<boolean>(false);
  const pendingPromptRef = useRef<string | null>(null);

  mutedRef.current = micMuted;

  const stopPlaybackQueue = () => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    activeSourcesRef.current = [];
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  };

  const play24kHzPcmChunk = (base64Audio: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const samples = base64PcmToFloat32(base64Audio);
    if (samples.length === 0) return;
    const buffer = ctx.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startTime = Math.max(nextStartTimeRef.current, ctx.currentTime);
    source.start(startTime);
    nextStartTimeRef.current = startTime + buffer.duration;
    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
    };
  };

  const stopSession = () => {
    stopPlaybackQueue();
    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      void inputCtxRef.current?.close();
      void outputCtxRef.current?.close();
    } catch {
      // ignore
    }
    inputCtxRef.current = null;
    outputCtxRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setSessionState('idle');
    setMicMuted(false);
  };

  const startVoiceSession = async (autoPrompt?: string | null) => {
    const token = getStoredToken();
    const usePublicMode = publicMode || !token;
    if (!token && !usePublicMode) return;

    pendingPromptRef.current = autoPrompt || null;
    setErrorMsg(null);
    setSessionState('connecting');

    try {
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = micStream;
      } catch {
        setTranscripts((prev) => [
          ...prev,
          {
            id: `sys_${Date.now()}`,
            speaker: 'system',
            text: 'Microphone unavailable. You can still type questions below and hear spoken replies.',
          },
        ]);
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams();
      if (token) {
        params.set('token', token);
      } else {
        params.set('mode', 'public');
      }
      const wsUrl = `${proto}//${window.location.host}/ws/voice?${params.toString()}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type: string;
            audio?: string;
            text?: string;
            error?: string;
            verifiedPhone?: string | null;
          };

          if (msg.type === 'voice-ready') {
            setSessionState('live');
            if (msg.verifiedPhone) setVerifiedPhone(msg.verifiedPhone);
            if (micStream && inputCtx) {
              const source = inputCtx.createMediaStreamSource(micStream);
              const processor = inputCtx.createScriptProcessor(4096, 1, 1);
              processorRef.current = processor;
              source.connect(processor);
              processor.connect(inputCtx.destination);
              processor.onaudioprocess = (e) => {
                if (mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
                const base64 = floatTo16BitPcmBase64(e.inputBuffer.getChannelData(0));
                ws.send(JSON.stringify({ audio: base64 }));
              };
            }
            if (pendingPromptRef.current && ws.readyState === WebSocket.OPEN) {
              const promptToSend = pendingPromptRef.current;
              pendingPromptRef.current = null;
              setTranscripts((prev) => [
                ...prev,
                { id: `init_${Date.now()}`, speaker: 'you', text: promptToSend },
              ]);
              ws.send(JSON.stringify({ text: promptToSend }));
            }
          } else if (msg.type === 'tool-activity' && msg.text) {
            setTranscripts((prev) => [
              ...prev,
              {
                id: `tool_${Date.now()}_${Math.random()}`,
                speaker: 'system',
                text: msg.text!,
              },
            ]);
          } else if (msg.type === 'audio' && msg.audio) {
            play24kHzPcmChunk(msg.audio);
          } else if (msg.type === 'interrupted') {
            stopPlaybackQueue();
          } else if (msg.type === 'input-transcript' && msg.text) {
            setTranscripts((prev) => [
              ...prev,
              { id: `in_${Date.now()}_${Math.random()}`, speaker: 'you', text: msg.text! },
            ]);
          } else if (msg.type === 'output-transcript' && msg.text) {
            setTranscripts((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.speaker === 'assistant') {
                return [
                  ...prev.slice(0, -1),
                  { ...last, text: `${last.text}${msg.text}` },
                ];
              }
              return [
                ...prev,
                {
                  id: `out_${Date.now()}_${Math.random()}`,
                  speaker: 'assistant',
                  text: msg.text!,
                },
              ];
            });
          } else if (msg.type === 'voice-error') {
            setErrorMsg(msg.error || 'Voice assistant connection error.');
            setSessionState('error');
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        setErrorMsg('Unable to open live voice connection.');
        setSessionState('error');
      };

      ws.onclose = () => {
        setSessionState((prev) => (prev === 'error' ? 'error' : 'idle'));
      };
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start audio session.');
      setSessionState('error');
    }
  };

  useEffect(() => {
    if (!open) {
      stopSession();
      setTranscripts([]);
      setErrorMsg(null);
      return;
    }
    if (initialPrompt) {
      void startVoiceSession(initialPrompt);
    }
    return () => stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPrompt]);

  const sendTextOrStart = (promptText: string) => {
    const clean = promptText.trim();
    if (!clean) return;
    if (wsRef.current?.readyState === WebSocket.OPEN && sessionState === 'live') {
      setTranscripts((prev) => [
        ...prev,
        { id: `txt_${Date.now()}`, speaker: 'you', text: clean },
      ]);
      wsRef.current.send(JSON.stringify({ text: clean }));
      return;
    }
    void startVoiceSession(clean);
  };

  const handleSendText = (e: FormEvent) => {
    e.preventDefault();
    if (!textQuestion.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    const text = textQuestion.trim();
    setTranscripts((prev) => [
      ...prev,
      { id: `txt_${Date.now()}`, speaker: 'you', text },
    ]);
    wsRef.current.send(JSON.stringify({ text }));
    setTextQuestion('');
  };

  if (!open) return null;

  const isGuest = publicMode || !getStoredToken();
  const samplePrompts = isGuest
    ? [
        'How does Aarogya Drishti oral screening work?',
        'Find verified oral screening hospitals in Bengaluru.',
        'How do I take a clear photo of my mouth?',
        'What oral cancer warning signs should I watch for?',
      ]
    : [
        'Check my latest oral screening report and risk level.',
        'Find verified oral screening hospitals in Bengaluru.',
        'What are my upcoming consultation appointments?',
        'How should I take a clear photo of my tongue or inner cheek?',
      ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#0A192F]/50 backdrop-blur-xs">
      <div className="w-full max-w-md bg-[#FBFBFA] h-full border-l border-gray-200 flex flex-col shadow-2xl">
        <div className="ad-grad-navy relative overflow-hidden px-6 py-4 text-white flex items-center justify-between">
          <div className="ad-banner-grid absolute inset-0 pointer-events-none opacity-60" />
          <div className="relative z-10 flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-white/15 border border-[#2DD4BF]/40 flex items-center justify-center text-[#A7F3D0] shrink-0">
              <Volume2 className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-bold font-display">
                Aarogya Drishti Voice Guide
              </h3>
              <p className="text-[11px] text-[#A7F3D0]">
                {verifiedPhone
                  ? `Verified ${verifiedPhone} · Live clinical navigation`
                  : isGuest
                  ? 'Homepage AI Voice Guide · Gemini Live'
                  : `Live oral health guidance (${userRole.replace('_', ' ')})`}
              </p>
            </div>
          </div>
          <div className="relative z-10 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                stopSession();
                onClose();
              }}
              aria-label="Close voice assistant"
              className="p-2 text-white/80 hover:text-white hover:bg-white/15 rounded-full cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-3 bg-[#FEF4EB] border-b border-amber-200/80 text-[11px] text-gray-800">
          Voice Guide automatically replies in the language you speak, including mixed-language
          speech. It supports oral screening navigation and risk awareness, but does not diagnose
          cancer or replace an exam by a qualified doctor.
        </div>

        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
            {errorMsg}
          </div>
        )}

        {/* Controls */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-3 bg-white">
          {sessionState === 'idle' || sessionState === 'error' ? (
            <button
              type="button"
              onClick={() => void startVoiceSession()}
              className="ad-btn-teal flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white rounded-full cursor-pointer transition-all"
            >
              <Mic className="w-4 h-4" />
              Start Live Voice Assistance
            </button>
          ) : sessionState === 'connecting' ? (
            <div className="flex-1 text-center text-xs font-medium text-[#0E5C63] py-2">
              Connecting to Gemini Live Voice...
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMicMuted((m) => !m)}
                className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-full border cursor-pointer transition-colors ${
                  micMuted
                    ? 'bg-[#FDEEEE] border-[#A6243A]/25 text-[#A6243A]'
                    : 'bg-[#E6FAF4] border-[#2CD6A7]/35 text-[#0E5C63]'
                }`}
              >
                {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {micMuted ? 'Mic Muted' : 'Listening Live'}
              </button>
              <button
                type="button"
                onClick={stopSession}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#A6243A] hover:bg-[#8E1E31] rounded-full cursor-pointer"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                End
              </button>
            </>
          )}
        </div>

        {/* Live Transcripts */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {transcripts.length === 0 ? (
            <div className="space-y-3 py-2">
              <p className="text-xs font-semibold text-[#0B2528]">
                Tap a question to hear the AI Guide, or start speaking:
              </p>
              <div className="space-y-2">
                {samplePrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendTextOrStart(prompt)}
                    className="w-full text-left px-3.5 py-2.5 rounded-2xl bg-white border border-[#0B2528]/8 hover:border-[#147B83]/40 text-xs font-medium text-[#0B2528] flex items-center justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <span>&ldquo;{prompt}&rdquo;</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#0E5C63] shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            transcripts.map((t) => (
              <div
                key={t.id}
                className={`p-3.5 rounded-2xl text-xs leading-relaxed ${
                  t.speaker === 'you'
                    ? 'bg-[#E6FAF4] border border-[#2CD6A7]/30 text-[#0B2528] ml-6'
                    : t.speaker === 'system'
                    ? 'bg-[#F5F2EB] text-[#4A6468]'
                    : 'bg-white border border-[#0B2528]/8 text-[#0B2528] mr-6 shadow-xs'
                }`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#4A6468] mb-1">
                  {t.speaker === 'you'
                    ? 'You'
                    : t.speaker === 'system'
                    ? 'Notice'
                    : 'Aarogya Voice Guide'}
                </p>
                <p>{t.text}</p>
              </div>
            ))
          )}
        </div>

        {isGuest && onSignInRequest && (
          <div className="px-5 py-2.5 bg-[#ECFDF5] border-t border-emerald-200/80 flex items-center justify-between gap-2 text-xs">
            <span className="text-gray-900 font-medium">
              Want personal reports or booking?
            </span>
            <button
              type="button"
              onClick={() => {
                stopSession();
                onClose();
                onSignInRequest();
              }}
              className="ad-btn-teal rounded-full text-white px-3.5 py-1.5 font-semibold whitespace-nowrap cursor-pointer"
            >
              Sign In with OTP
            </button>
          </div>
        )}

        {/* Optional text prompt while live */}
        <form
          onSubmit={handleSendText}
          className="p-4 border-t border-gray-200 bg-white flex items-center gap-2"
        >
          <input
            type="text"
            disabled={sessionState !== 'live'}
            value={textQuestion}
            onChange={(e) => setTextQuestion(e.target.value)}
            placeholder={
              sessionState === 'live'
                ? 'Type a question for spoken reply...'
                : 'Start session above to speak or type...'
            }
            className="flex-1 px-3.5 py-2 text-xs border border-gray-300 rounded-full disabled:bg-[#FBFBFA] focus:outline-none focus:ring-2 focus:ring-[#0D5C58]"
          />
          <button
            type="submit"
            disabled={sessionState !== 'live' || !textQuestion.trim()}
            aria-label="Send question"
            className="ad-btn-teal p-2.5 text-white rounded-full disabled:opacity-50 cursor-pointer transition-all"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
