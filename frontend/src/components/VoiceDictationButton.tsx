import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { apiRequest } from '../utils/api.js';
import { useLocalization } from '../i18n.js';

interface SpeechRecognitionResultItem {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string } | undefined;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultItem>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

interface VoiceDictationButtonProps {
  onTranscript: (text: string) => void;
  onLiveTranscript?: (text: string) => void;
  initialText?: string;
  language?: string;
  contextHint?: string;
  label?: string;
}

function joinTranscript(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(' ');
}

export function VoiceDictationButton({
  onTranscript,
  onLiveTranscript,
  initialText = '',
  language,
  contextHint,
  label = 'Dictate',
}: VoiceDictationButtonProps) {
  const { language: appLanguage } = useLocalization();
  const recognitionLanguage =
    language ||
    (appLanguage === 'te' ? 'te-IN' : appLanguage === 'hi' ? 'hi-IN' : 'en-IN');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [offerAudioFallback, setOfferAudioFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const shouldContinueRecognitionRef = useRef(false);
  const recognitionFailedRef = useRef(false);
  const forceAudioFallbackRef = useRef(false);
  const mountedRef = useRef(true);
  const baseTranscriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const interimTranscriptRef = useRef('');
  const onTranscriptRef = useRef(onTranscript);
  const onLiveTranscriptRef = useRef(onLiveTranscript);
  onTranscriptRef.current = onTranscript;
  onLiveTranscriptRef.current = onLiveTranscript;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      shouldContinueRecognitionRef.current = false;
      recognitionRef.current?.abort();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = async () => {
    setError(null);
    setOfferAudioFallback(false);
    setInterimTranscript('');
    baseTranscriptRef.current = initialText.trim();
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';

    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechRecognition =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (SpeechRecognition && !forceAudioFallbackRef.current) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = recognitionLanguage;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognitionRef.current = recognition;
        shouldContinueRecognitionRef.current = true;
        recognitionFailedRef.current = false;
        recognition.onresult = (event) => {
          if (!mountedRef.current) return;
          let interim = '';
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            const transcript = result[0]?.transcript.trim() || '';
            if (!transcript) continue;
            if (result.isFinal) {
              finalTranscriptRef.current = joinTranscript(finalTranscriptRef.current, transcript);
            } else {
              interim = joinTranscript(interim, transcript);
            }
          }
          interimTranscriptRef.current = interim;
          setInterimTranscript(interim);
          const currentText = joinTranscript(
            baseTranscriptRef.current,
            finalTranscriptRef.current,
            interim
          );
          if (currentText) onLiveTranscriptRef.current?.(currentText);
        };
        recognition.onerror = (event) => {
          if (!mountedRef.current) return;
          if (event.error === 'no-speech' || event.error === 'aborted') return;
          shouldContinueRecognitionRef.current = false;
          recognitionFailedRef.current = true;
          recognitionRef.current = null;
          setRecording(false);
          setOfferAudioFallback(true);
          setError(`Live dictation failed (${event.error}). Check microphone access and try again.`);
        };
        recognition.onend = () => {
          if (!mountedRef.current) return;
          if (recognitionFailedRef.current) return;
          if (shouldContinueRecognitionRef.current) {
            try {
              recognition.start();
              return;
            } catch {
              shouldContinueRecognitionRef.current = false;
              setError('Live dictation stopped unexpectedly. Please try again.');
            }
          }
          const spokenText = finalTranscriptRef.current || interimTranscriptRef.current;
          const fullText = joinTranscript(baseTranscriptRef.current, spokenText);
          if (fullText) onTranscriptRef.current(fullText);
          setRecording(false);
          setInterimTranscript('');
          recognitionRef.current = null;
        };
        recognition.start();
        setRecording(true);
        return;
      } catch {
        recognitionRef.current = null;
        shouldContinueRecognitionRef.current = false;
        setError('Unable to start live speech recognition. You can still record and transcribe after stopping.');
      }
    }
    forceAudioFallbackRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!mountedRef.current) return;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size === 0) {
          setError('No audio was captured. Please check microphone permission and try again.');
          return;
        }
        setTranscribing(true);
        try {
          const formData = new FormData();
          formData.append('audio', blob, 'dictation.webm');
          if (contextHint) formData.append('contextHint', contextHint);
          const result = await apiRequest<{ transcript: string }>('/api/voice/transcribe', {
            method: 'POST',
            body: formData,
          });
          if (result.transcript) {
            onTranscriptRef.current(joinTranscript(baseTranscriptRef.current, result.transcript));
          } else {
            setError('No speech was recognized. Please try again.');
          }
        } catch (transcriptionError) {
          setError(
            transcriptionError instanceof Error
              ? transcriptionError.message
              : 'Transcription failed.'
          );
        } finally {
          setTranscribing(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (recordingError) {
      if (
        recordingError instanceof Error &&
        ['NotAllowedError', 'PermissionDeniedError'].includes(recordingError.name)
      ) {
        setError('Microphone permission denied. Allow microphone access and try again.');
      } else {
        setError(
          recordingError instanceof Error
            ? `Unable to access the microphone: ${recordingError.message}`
            : 'Unable to access the microphone.'
        );
      }
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      shouldContinueRecognitionRef.current = false;
      recognitionRef.current.stop();
      setRecording(false);
      return;
    }
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
      setRecording(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={transcribing}
        onClick={() => (recording ? stopRecording() : void startRecording())}
        aria-pressed={recording}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border cursor-pointer disabled:opacity-60 ${
          recording
            ? 'bg-red-50 border-red-300 text-red-700'
            : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
        }`}
      >
        {recording ? (
          <>
            <Square className="w-3 h-3 fill-current" />
            Stop
          </>
        ) : (
          <>
            <Mic className="w-3 h-3 text-teal-700" />
            {transcribing ? 'Transcribing...' : label}
          </>
        )}
      </button>
      {recording && (
        <span aria-live="polite" className="text-[11px] text-teal-800">
          Listening{interimTranscript ? `: ${interimTranscript}` : '…'}
        </span>
      )}
      {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
      {offerAudioFallback && (
        <button
          type="button"
          onClick={() => {
            forceAudioFallbackRef.current = true;
            void startRecording();
          }}
          className="text-[11px] font-semibold text-teal-800 underline"
        >
          Record and transcribe instead
        </button>
      )}
    </span>
  );
}
