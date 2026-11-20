import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  PhoneOff,
  Send,
  ShieldCheck,
  Video,
  VideoOff,
} from 'lucide-react';
import type { WsSignalMessage } from '../hooks/useWebSocket.js';
import type { UserRole } from '../../../shared/types/index.js';
import { apiRequest } from '../utils/api.js';
import { VoiceDictationButton } from './VoiceDictationButton.js';

interface VideoConsultationRoomProps {
  appointmentId: string;
  appointmentCode: string;
  patientName: string;
  doctorName: string;
  userRole: UserRole;
  userName: string;
  sendWsMessage: (payload: Record<string, unknown>) => void;
  lastSignalMessage: WsSignalMessage | null;
  onClose: () => void;
  onConsultationSaved?: () => void;
}

interface ChatEntry {
  fromName: string;
  fromRole: string;
  text: string;
  timestamp: string;
}

export function VideoConsultationRoom({
  appointmentId,
  appointmentCode,
  patientName,
  doctorName,
  userRole,
  userName,
  sendWsMessage,
  lastSignalMessage,
  onClose,
  onConsultationSaved,
}: VideoConsultationRoomProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [inCall, setInCall] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<
    Array<{ userId: string; role: string; name: string }>
  >([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<ChatEntry[]>([]);

  // Doctor consultation notes state
  const [clinicalObservations, setClinicalObservations] = useState('');
  const [consultationNotes, setConsultationNotes] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [referralRecommended, setReferralRecommended] = useState(false);
  const [referralDetails, setReferralDetails] = useState('');
  const [diagnosticTests, setDiagnosticTests] = useState('In-person clinical examination');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpInstructions, setFollowUpInstructions] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSavedMsg, setNotesSavedMsg] = useState<string | null>(null);

  // Call timer
  useEffect(() => {
    if (!inCall) return;
    const timer = window.setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [inCall]);

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWsMessage({
          type: 'webrtc-signal',
          signal: { kind: 'ice', candidate: event.candidate },
        });
      }
    };

    peerRef.current = pc;
    return pc;
  };

  const joinCall = async () => {
    setMediaError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setInCall(true);
      createPeerConnection();
      sendWsMessage({ type: 'join-call', appointmentId });
    } catch {
      setMediaError(
        'Camera or microphone access was unavailable or denied. You can still use in-call text chat or grant browser media permissions.'
      );
      setInCall(true);
      sendWsMessage({ type: 'join-call', appointmentId });
    }
  };

  const leaveCall = () => {
    sendWsMessage({ type: 'leave-call', appointmentId });
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setInCall(false);
  };

  useEffect(() => {
    return () => {
      sendWsMessage({ type: 'leave-call', appointmentId });
      peerRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle incoming WebRTC signaling & chat messages
  useEffect(() => {
    if (!lastSignalMessage) return;

    if (
      lastSignalMessage.type === 'room-participants' &&
      lastSignalMessage.appointmentId === appointmentId
    ) {
      const list = lastSignalMessage.participants || [];
      setParticipants(list);
      // Doctor initiates WebRTC offer when both participants are in the room
      if (list.length >= 2 && userRole === 'doctor' && peerRef.current) {
        void (async () => {
          const pc = peerRef.current!;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendWsMessage({
            type: 'webrtc-signal',
            signal: { kind: 'offer', sdp: offer },
          });
        })();
      }
    }

    if (lastSignalMessage.type === 'webrtc-signal' && lastSignalMessage.signal) {
      const sig = lastSignalMessage.signal as {
        kind: string;
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      };
      const pc = peerRef.current || createPeerConnection();
      void (async () => {
        if (sig.kind === 'offer' && sig.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWsMessage({
            type: 'webrtc-signal',
            signal: { kind: 'answer', sdp: answer },
          });
        } else if (sig.kind === 'answer' && sig.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
        } else if (sig.kind === 'ice' && sig.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(sig.candidate));
        }
      })();
    }

    if (lastSignalMessage.type === 'call-chat' && lastSignalMessage.text) {
      setChatLog((prev) => [
        ...prev,
        {
          fromName: lastSignalMessage.fromName || 'Participant',
          fromRole: lastSignalMessage.fromRole || '',
          text: lastSignalMessage.text!,
          timestamp: lastSignalMessage.timestamp || new Date().toISOString(),
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSignalMessage]);

  const toggleAudio = () => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = next;
    });
    sendWsMessage({
      type: 'media-state',
      mediaState: { audio: next, video: videoEnabled },
    });
  };

  const toggleVideo = () => {
    const next = !videoEnabled;
    setVideoEnabled(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = next;
    });
    sendWsMessage({
      type: 'media-state',
      mediaState: { audio: audioEnabled, video: next },
    });
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    sendWsMessage({ type: 'call-chat', text: chatInput.trim() });
    setChatInput('');
  };

  const handleSaveDoctorNotes = async (markCompleted: boolean) => {
    setSavingNotes(true);
    setNotesSavedMsg(null);
    try {
      await apiRequest('/api/doctor/consultations', {
        method: 'POST',
        body: JSON.stringify({
          appointmentId,
          durationSeconds: elapsedSeconds,
          clinicalObservations,
          consultationNotes,
          recommendations,
          referralRecommended,
          referralDetails,
          diagnosticTestsSuggested: diagnosticTests
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          followUpDate,
          followUpInstructions,
          sharedWithPatient: true,
          markCompleted,
        }),
      });
      setNotesSavedMsg(
        markCompleted
          ? 'Consultation completed and clinical notes shared with patient.'
          : 'Draft consultation notes saved.'
      );
      onConsultationSaved?.();
    } catch (err) {
      setNotesSavedMsg(err instanceof Error ? err.message : 'Unable to save consultation notes.');
    } finally {
      setSavingNotes(false);
    }
  };

  const formattedTime = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(
    elapsedSeconds % 60
  ).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-6xl overflow-hidden shadow-2xl my-auto">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-mono text-teal-300">
              {appointmentCode} · Encrypted WebRTC Consultation
            </p>
            <h2 className="text-base font-bold">
              {doctorName} &amp; {patientName}
            </h2>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 text-slate-300">
              <ShieldCheck className="w-4 h-4 text-teal-400" />
              Calls are not recorded by default
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums text-white">
              {formattedTime}
            </span>
            <button
              type="button"
              onClick={() => {
                leaveCall();
                onClose();
              }}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
            >
              Exit Room
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-12">
          {/* Video Stage */}
          <div
            className={`${
              userRole === 'doctor' ? 'lg:col-span-7' : 'lg:col-span-8'
            } bg-slate-950 p-5 flex flex-col justify-between min-h-[460px]`}
          >
            {mediaError && (
              <div className="mb-3 p-3 rounded-lg bg-amber-950/80 border border-amber-700 text-amber-200 text-xs">
                {mediaError}
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4 flex-1 items-center">
              <div className="relative bg-slate-900 rounded-xl overflow-hidden border border-slate-800 aspect-video flex items-center justify-center">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded bg-black/70 text-white text-xs">
                  {userRole === 'doctor' ? `Patient: ${patientName}` : `Doctor: ${doctorName}`}
                </div>
              </div>

              <div className="relative bg-slate-900 rounded-xl overflow-hidden border border-slate-800 aspect-video flex items-center justify-center">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded bg-black/70 text-white text-xs">
                  You ({userName} · {userRole})
                </div>
              </div>
            </div>

            {/* Active participants & controls */}
            <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="text-xs text-slate-400">
                Room Participants:{' '}
                {participants.length > 0
                  ? participants.map((p) => `${p.name} (${p.role})`).join(', ')
                  : 'Waiting to join'}
              </div>

              <div className="flex items-center gap-3">
                {!inCall ? (
                  <button
                    type="button"
                    onClick={() => void joinCall()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold rounded-lg cursor-pointer"
                  >
                    <Video className="w-4 h-4" />
                    Join Video Consultation
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={toggleAudio}
                      className={`p-3 rounded-lg text-white cursor-pointer ${
                        audioEnabled ? 'bg-slate-800 hover:bg-slate-700' : 'bg-red-600'
                      }`}
                      title={audioEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
                    >
                      {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={toggleVideo}
                      className={`p-3 rounded-lg text-white cursor-pointer ${
                        videoEnabled ? 'bg-slate-800 hover:bg-slate-700' : 'bg-red-600'
                      }`}
                      title={videoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
                    >
                      {videoEnabled ? (
                        <Video className="w-4 h-4" />
                      ) : (
                        <VideoOff className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={leaveCall}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      <PhoneOff className="w-4 h-4" />
                      End Call
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel: Doctor Clinical Notes OR Patient In-Call Chat */}
          <div
            className={`${
              userRole === 'doctor' ? 'lg:col-span-5' : 'lg:col-span-4'
            } border-l border-slate-200 flex flex-col max-h-[600px]`}
          >
            {userRole === 'doctor' ? (
              <div className="p-5 overflow-y-auto space-y-3">
                <h3 className="text-sm font-bold text-slate-900">
                  Doctor Consultation Notes &amp; Recommendations
                </h3>
                {notesSavedMsg && (
                  <div className="p-2.5 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-900 font-medium">
                    {notesSavedMsg}
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-semibold text-slate-700">
                      Clinical Observations
                    </label>
                    <VoiceDictationButton
                      contextHint="Doctor clinical oral examination observations during teleconsultation"
                      onTranscript={(text) =>
                        setClinicalObservations((prev) => (prev ? `${prev} ${text}` : text))
                      }
                    />
                  </div>
                  <textarea
                    rows={2}
                    value={clinicalObservations}
                    onChange={(e) => setClinicalObservations(e.target.value)}
                    placeholder="Document mucosal findings, palpation/visual notes..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Consultation Notes &amp; Plan
                  </label>
                  <textarea
                    rows={2}
                    value={consultationNotes}
                    onChange={(e) => setConsultationNotes(e.target.value)}
                    placeholder="Clinical assessment summary..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Recommendations &amp; Habit Cessation Advice
                  </label>
                  <textarea
                    rows={2}
                    value={recommendations}
                    onChange={(e) => setRecommendations(e.target.value)}
                    placeholder="Recommended clinical care, oral hygiene, cessation..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Suggested Diagnostic Steps (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={diagnosticTests}
                    onChange={(e) => setDiagnosticTests(e.target.value)}
                    placeholder="In-person oral exam, Biopsy, Toluidine blue"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={referralRecommended}
                    onChange={(e) => setReferralRecommended(e.target.checked)}
                  />
                  Recommend Biopsy / In-Person Specialist Referral
                </label>
                {referralRecommended && (
                  <input
                    type="text"
                    value={referralDetails}
                    onChange={(e) => setReferralDetails(e.target.value)}
                    placeholder="Specify specialist department or diagnostic center..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Follow-Up Date
                    </label>
                    <input
                      type="date"
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Follow-Up Instructions
                    </label>
                    <input
                      type="text"
                      value={followUpInstructions}
                      onChange={(e) => setFollowUpInstructions(e.target.value)}
                      placeholder="Review in 14 days..."
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    disabled={savingNotes}
                    onClick={() => void handleSaveDoctorNotes(false)}
                    className="px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Save Draft
                  </button>
                  <button
                    type="button"
                    disabled={savingNotes}
                    onClick={() => void handleSaveDoctorNotes(true)}
                    className="flex-1 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                  >
                    {savingNotes ? 'Saving...' : 'Complete & Share with Patient'}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Live In-Call Chat */}
            <div className="border-t border-slate-200 flex-1 flex flex-col min-h-[200px] bg-slate-50">
              <div className="px-4 py-2.5 border-b border-slate-200 bg-white text-xs font-bold text-slate-700">
                Live Consultation Messages
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {chatLog.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    Share clarifications or questions during your video consultation.
                  </p>
                ) : (
                  chatLog.map((c, idx) => (
                    <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2.5">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mb-0.5">
                        <span className="font-semibold text-slate-800">
                          {c.fromName} · {c.fromRole}
                        </span>
                        <span className="font-mono">
                          {new Date(c.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700">{c.text}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="p-3 bg-white border-t border-slate-200 flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                  placeholder="Type a message..."
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <button
                  type="button"
                  onClick={sendChat}
                  aria-label="Send message"
                  className="p-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
