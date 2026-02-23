import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Phone, PhoneOff, Mic, MicOff, Camera, CameraOff, Monitor, MonitorOff,
  Volume2, Loader2, X, Play, Brain,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
};

type CallState = "idle" | "setup" | "listening" | "thinking" | "speaking";

const VOICES = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", gender: "Male", desc: "Professional mentor" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "Female", desc: "Warm & confident" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", gender: "Male", desc: "Calm & authoritative" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", gender: "Female", desc: "Energetic & clear" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "Male", desc: "Friendly & engaging" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", gender: "Female", desc: "Professional & smooth" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function VoiceCallAssistant({ open, onClose }: Props) {
  const [callState, setCallState] = useState<CallState>("setup");
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].id);
  const [consentGiven, setConsentGiven] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [screenShareActive, setScreenShareActive] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentInterim, setCurrentInterim] = useState("");
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false);

  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isProcessingRef = useRef(false);
  const shouldContinueRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, currentInterim]);

  useEffect(() => {
    if (!open) {
      endCall();
      setCallState("setup");
    }
  }, [open]);

  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
  };

  const previewVoice = async (voiceId: string) => {
    setPreviewPlaying(true);
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-brain`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          question: "Hello! I'm your AI Brain assistant. How can I help you today?",
          mode: "blast",
          voiceId,
        }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (data.audio) {
        const audio = new Audio(`data:audio/mpeg;base64,${data.audio}`);
        audio.onended = () => setPreviewPlaying(false);
        audio.onerror = () => { setPreviewPlaying(false); toast.error("Audio playback failed"); };
        await audio.play();
      } else {
        setPreviewPlaying(false);
        toast.error("No audio received");
      }
    } catch (e: any) {
      setPreviewPlaying(false);
      toast.error(e.message || "Preview failed");
    }
  };

  const startCall = async () => {
    if (!consentGiven) {
      toast.error("Please accept the privacy consent to continue");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition not supported in this browser. Use Chrome.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch {
      toast.error("Microphone access is required");
      return;
    }

    shouldContinueRef.current = true;
    setCallState("listening");
    setTranscript([]);
    setCurrentInterim("");
    startListening();
  };

  const startListening = useCallback(() => {
    if (!shouldContinueRef.current || isProcessingRef.current) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalText = "";
    let silenceTimer: any = null;

    recognition.onresult = (event: any) => {
      let interim = "";
      let newFinal = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          newFinal += t;
        } else {
          interim += t;
        }
      }
      if (newFinal) {
        finalText += (finalText ? " " : "") + newFinal;
      }
      setCurrentInterim(finalText + (interim ? " " + interim : ""));

      clearTimeout(silenceTimer);
      if (finalText.trim()) {
        silenceTimer = setTimeout(() => {
          recognition.stop();
        }, 1800);
      }
    };

    recognition.onend = async () => {
      recognitionRef.current = null;
      const text = finalText.trim();
      if (text && shouldContinueRef.current) {
        setCurrentInterim("");
        await processUserInput(text);
      } else if (shouldContinueRef.current) {
        setCurrentInterim("");
        setTimeout(() => startListening(), 200);
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error === "no-speech" && shouldContinueRef.current) {
        setTimeout(() => startListening(), 300);
        return;
      }
      if (e.error === "not-allowed") {
        toast.error("Microphone permission denied");
        shouldContinueRef.current = false;
        setCallState("idle");
        return;
      }
      if (e.error !== "aborted") {
        console.error("Speech error:", e.error);
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setCallState("listening");
    } catch (err) {
      console.error("Failed to start recognition:", err);
      setTimeout(() => startListening(), 500);
    }
  }, []);

  const processUserInput = async (text: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    setTranscript(prev => [...prev, { role: "user", text, timestamp: new Date() }]);
    setCallState("thinking");

    try {
      const headers = await getAuthHeaders();

      // Capture frame if camera/screen is active
      let frameBase64: string | undefined;
      if (canvasRef.current) {
        const sourceVideo = screenShareActive ? screenVideoRef.current : (cameraActive ? cameraVideoRef.current : null);
        if (sourceVideo && sourceVideo.videoWidth > 0) {
          const canvas = canvasRef.current;
          canvas.width = Math.min(sourceVideo.videoWidth, 640);
          canvas.height = Math.round(canvas.width * (sourceVideo.videoHeight / sourceVideo.videoWidth));
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
          frameBase64 = canvas.toDataURL("image/jpeg", 0.6);
        }
      }

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-brain`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          question: text,
          mode: "full",
          voiceId: selectedVoice,
          frame: frameBase64,
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();

      if (data.text) {
        setTranscript(prev => [...prev, { role: "assistant", text: data.text, timestamp: new Date() }]);
      }

      setCallState("speaking");

      if (data.audio) {
        const audio = new Audio(`data:audio/mpeg;base64,${data.audio}`);
        audioRef.current = audio;
        audio.onended = () => {
          audioRef.current = null;
          isProcessingRef.current = false;
          if (shouldContinueRef.current) startListening();
        };
        audio.onerror = () => {
          audioRef.current = null;
          isProcessingRef.current = false;
          if (shouldContinueRef.current) startListening();
        };
        await audio.play();
      } else {
        isProcessingRef.current = false;
        if (shouldContinueRef.current) startListening();
      }
    } catch (e: any) {
      console.error("Voice brain error:", e);
      toast.error(e.message || "Failed to get response");
      isProcessingRef.current = false;
      if (shouldContinueRef.current) startListening();
    }
  };

  const endCall = useCallback(() => {
    shouldContinueRef.current = false;
    isProcessingRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    setCameraActive(false);
    setScreenShareActive(false);
    setMicMuted(false);
    setCurrentInterim("");
  }, []);

  // Camera toggle — direct gesture handler
  const toggleCamera = async () => {
    if (cameraActive) {
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
      setCameraActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        cameraStreamRef.current = stream;
        setCameraActive(true);
        // Stop screen share if active
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach(t => t.stop());
          screenStreamRef.current = null;
          setScreenShareActive(false);
        }
      } catch (err: any) {
        if (err.name === "NotAllowedError") {
          toast.error("Camera access denied. Check browser permissions.");
        } else {
          toast.error("Could not access camera");
        }
      }
    }
  };

  // Assign camera stream to video element when active
  useEffect(() => {
    if (cameraActive && cameraVideoRef.current && cameraStreamRef.current) {
      cameraVideoRef.current.srcObject = cameraStreamRef.current;
    }
  }, [cameraActive]);

  // Screen share toggle — direct gesture handler
  const toggleScreenShare = async () => {
    if (screenShareActive) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      setScreenShareActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        stream.getVideoTracks()[0].onended = () => {
          screenStreamRef.current = null;
          setScreenShareActive(false);
        };
        setScreenShareActive(true);
        // Stop camera if active
        if (cameraStreamRef.current) {
          cameraStreamRef.current.getTracks().forEach(t => t.stop());
          cameraStreamRef.current = null;
          setCameraActive(false);
        }
      } catch (err: any) {
        if (err.name === "NotAllowedError") {
          toast.error("Screen share cancelled or denied.");
        } else {
          toast.error("Screen sharing failed");
        }
      }
    }
  };

  // Assign screen stream to video element
  useEffect(() => {
    if (screenShareActive && screenVideoRef.current && screenStreamRef.current) {
      screenVideoRef.current.srcObject = screenStreamRef.current;
    }
  }, [screenShareActive]);

  const toggleMic = () => {
    if (micMuted) {
      setMicMuted(false);
      if (callState === "listening") startListening();
    } else {
      setMicMuted(true);
      recognitionRef.current?.stop();
    }
  };

  const handleEndCall = () => {
    endCall();
    setCallState("idle");
    onClose();
  };

  if (!open) return null;

  const selectedVoiceData = VOICES.find(v => v.id === selectedVoice);
  const isInCall = callState !== "idle" && callState !== "setup";
  const showVideoFeed = cameraActive || screenShareActive;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md" onClick={isInCall ? undefined : handleEndCall} />

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Fullscreen Camera/Screen View */}
      {showVideoFeed && isInCall && (
        <div className="absolute inset-0 z-[101] bg-black">
          {cameraActive && (
            <video
              ref={cameraVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          )}
          {screenShareActive && (
            <video
              ref={screenVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain bg-black"
            />
          )}
        </div>
      )}

      {/* Call Card */}
      <div className={`relative z-[102] w-full mx-4 rounded-3xl border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-300 ${
        showVideoFeed && isInCall ? "max-w-sm bg-card/90 backdrop-blur-lg" : "max-w-lg"
      }`}>

        {/* ── SETUP SCREEN ── */}
        {callState === "setup" && (
          <div className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Brain className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-bold text-lg">Call The Brain</h2>
                  <p className="text-xs text-muted-foreground">Voice assistant powered by your uploads</p>
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={handleEndCall} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Voice Selection — native dropdown */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Choose Voice</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <select
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 appearance-none cursor-pointer pr-8"
                  >
                    {VOICES.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.gender}) — {v.desc}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => previewVoice(selectedVoice)}
                  disabled={previewPlaying}
                  title="Preview voice"
                >
                  {previewPlaying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Consent */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border">
              <Checkbox
                id="consent"
                checked={consentGiven}
                onCheckedChange={(c) => setConsentGiven(!!c)}
                className="mt-0.5"
              />
              <label htmlFor="consent" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                I allow temporary audio/video capture for this session. Audio and video are processed in real-time and not stored permanently. Session data is discarded when the call ends.
              </label>
            </div>

            <Button className="w-full h-12 text-base gap-2" onClick={startCall} disabled={!consentGiven}>
              <Phone className="h-5 w-5" /> Start Call
            </Button>
          </div>
        )}

        {/* ── IN-CALL SCREEN ── */}
        {isInCall && (
          <div className="flex flex-col" style={{ height: showVideoFeed ? "auto" : "min(80vh, 600px)" }}>
            {/* Header */}
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Brain className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">The Brain</p>
                  <p className="text-[10px] text-muted-foreground">{selectedVoiceData?.name} • {selectedVoiceData?.desc}</p>
                </div>
              </div>
              {/* Mid-call voice switcher — native dropdown */}
              <div className="relative">
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  className="h-7 text-xs rounded-md bg-muted/50 border-none px-2 pr-6 appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {VOICES.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.gender})
                    </option>
                  ))}
                </select>
                <Volume2 className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none text-muted-foreground" />
              </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden p-4 min-h-[200px]">
              {/* Animated State Indicator */}
              <div className="relative mb-6">
                {callState === "listening" && (
                  <>
                    <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" style={{ animationDuration: "2s" }} />
                    <div className="absolute -inset-3 rounded-full bg-primary/5 animate-ping" style={{ animationDuration: "3s" }} />
                  </>
                )}
                {callState === "speaking" && (
                  <>
                    <div className="absolute -inset-2 rounded-full bg-primary/20 animate-pulse" />
                    <div className="absolute -inset-4 rounded-full bg-primary/10 animate-pulse" style={{ animationDelay: "200ms" }} />
                  </>
                )}

                <div className={`relative h-20 w-20 rounded-full flex items-center justify-center transition-all duration-500 ${
                  callState === "listening" ? "bg-primary/10 ring-4 ring-primary/20" :
                  callState === "thinking" ? "bg-muted" :
                  callState === "speaking" ? "bg-primary/15 ring-4 ring-primary/30" : "bg-muted"
                }`}>
                  {callState === "listening" && <Mic className="h-8 w-8 text-primary" />}
                  {callState === "thinking" && <Loader2 className="h-8 w-8 text-primary animate-spin" />}
                  {callState === "speaking" && (
                    <div className="flex items-end gap-1 h-8">
                      {[0, 1, 2, 3, 4].map(i => (
                        <div
                          key={i}
                          className="w-1.5 bg-primary rounded-full animate-bounce"
                          style={{
                            height: `${10 + Math.random() * 22}px`,
                            animationDelay: `${i * 100}ms`,
                            animationDuration: "0.6s",
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <p className="text-sm font-semibold mb-1">
                {callState === "listening" ? "Listening..." :
                 callState === "thinking" ? "Thinking..." :
                 callState === "speaking" ? "Speaking..." : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {callState === "listening" ? "Speak naturally — I'm ready" :
                 callState === "thinking" ? "Searching your brain..." :
                 callState === "speaking" ? "Listen to the response" : ""}
              </p>

              {/* Interim transcript while listening */}
              {callState === "listening" && currentInterim && (
                <div className="mt-3 px-4 py-2 rounded-xl bg-muted/50 border max-w-sm">
                  <p className="text-sm text-muted-foreground italic">"{currentInterim}"</p>
                </div>
              )}
            </div>

            {/* Transcript Panel */}
            {transcript.length > 0 && (
              <div className="border-t max-h-40">
                <div ref={scrollRef} className="overflow-y-auto p-3 space-y-2 max-h-40">
                  {transcript.map((entry, i) => (
                    <div key={i} className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${
                        entry.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}>
                        {entry.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Controls Bar */}
            <div className="p-4 border-t flex items-center justify-center">
              <div className="flex items-center gap-3 px-6 py-2 rounded-full bg-muted/50 border">
                <button
                  onClick={toggleCamera}
                  className={`h-12 w-12 rounded-full flex items-center justify-center transition-all ${
                    cameraActive ? "bg-primary text-primary-foreground" : "bg-background border hover:bg-muted"
                  }`}
                  title={cameraActive ? "Turn off camera" : "Turn on camera"}
                >
                  {cameraActive ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
                </button>

                <button
                  onClick={toggleScreenShare}
                  className={`h-12 w-12 rounded-full flex items-center justify-center transition-all ${
                    screenShareActive ? "bg-primary text-primary-foreground" : "bg-background border hover:bg-muted"
                  }`}
                  title={screenShareActive ? "Stop sharing" : "Share screen"}
                >
                  {screenShareActive ? <Monitor className="h-5 w-5" /> : <MonitorOff className="h-5 w-5" />}
                </button>

                <button
                  onClick={toggleMic}
                  className={`h-12 w-12 rounded-full flex items-center justify-center transition-all ${
                    micMuted ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-background border hover:bg-muted"
                  }`}
                  title={micMuted ? "Unmute" : "Mute"}
                >
                  {micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>

                <button
                  onClick={handleEndCall}
                  className="h-12 w-12 rounded-full flex items-center justify-center bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all"
                  title="End call"
                >
                  <PhoneOff className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Call ended state */}
        {callState === "idle" && (
          <div className="p-6 text-center space-y-4">
            <Brain className="h-12 w-12 mx-auto text-primary/40" />
            <p className="text-sm text-muted-foreground">Call ended</p>
            <Button onClick={() => setCallState("setup")} variant="outline">
              Start New Call
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
