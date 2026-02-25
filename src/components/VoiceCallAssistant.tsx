import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Monitor, MonitorOff,
  Volume2, Loader2, X, Play, Brain, Square,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

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
  onCallEnd?: (transcript: TranscriptEntry[]) => void;
}

export default function VoiceCallAssistant({ open, onClose, onCallEnd }: Props) {
  const isMobile = useIsMobile();
  const [callState, setCallState] = useState<CallState>("setup");
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].id);
  const [consentGiven, setConsentGiven] = useState(false);
  const [videoActive, setVideoActive] = useState(false);
  const [screenShareActive, setScreenShareActive] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentInterim, setCurrentInterim] = useState("");
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isProcessingRef = useRef(false);
  const shouldContinueRef = useRef(false);
  const selectedVoiceRef = useRef(selectedVoice);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const lastProcessedRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const previewAbortRef = useRef<AbortController | null>(null);

  // Keep refs in sync
  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  // Auto-scroll transcript to bottom on every change
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, currentInterim]);

  useEffect(() => {
    if (!open) {
      cleanup();
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

  const stopPreviewPlayback = useCallback(() => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;

    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = null;
    }

    setPreviewPlaying(false);
  }, []);

  const speakFallback = useCallback((text: string, voiceId: string) => {
    return new Promise<void>((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        resolve();
        return;
      }

      try {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        const selectedMeta = VOICES.find((v) => v.id === voiceId);
        const voices = window.speechSynthesis.getVoices();
        const genderHint = selectedMeta?.gender?.toLowerCase() || "";

        let browserVoice = voices.find((v) =>
          /^en/i.test(v.lang) &&
          (genderHint === "female"
            ? /female|zira|samantha|victoria|ava/i.test(v.name.toLowerCase())
            : /male|david|alex|daniel|google uk english male/i.test(v.name.toLowerCase()))
        );

        if (!browserVoice) browserVoice = voices.find((v) => /^en/i.test(v.lang)) || voices[0];
        if (browserVoice) utterance.voice = browserVoice;

        utterance.rate = voiceId === "pFZP5JQG7iQjIQuC4Bku" ? 1.05 : 1;
        utterance.pitch = genderHint === "female" ? 1.08 : 0.96;

        const timeout = window.setTimeout(() => resolve(), 15000);
        utterance.onend = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        utterance.onerror = () => {
          window.clearTimeout(timeout);
          resolve();
        };

        window.speechSynthesis.speak(utterance);
      } catch {
        resolve();
      }
    });
  }, []);

  // ─── PREVIEW: Cancel previous, play new ───
  const previewVoice = async (voiceId: string) => {
    stopPreviewPlayback();

    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewPlaying(true);

    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-brain`, {
        method: "POST",
        headers,
        signal: controller.signal,
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
        await new Promise<void>((resolve, reject) => {
          const audio = new Audio(`data:audio/mpeg;base64,${data.audio}`);
          previewAudioRef.current = audio;
          audio.onended = () => {
            previewAudioRef.current = null;
            resolve();
          };
          audio.onerror = () => {
            previewAudioRef.current = null;
            reject(new Error("Audio playback failed"));
          };
          audio.play().catch(reject);
        });
      } else {
        await speakFallback(data.text || "Voice preview unavailable. Using device fallback voice.", voiceId);
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast.error(e.message || "Preview failed");
      }
    } finally {
      if (previewAbortRef.current === controller) previewAbortRef.current = null;
      setPreviewPlaying(false);
    }
  };

  const startCall = async () => {
    if (!consentGiven) {
      toast.error("Please accept the consent to continue");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition not supported. Use Chrome.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch {
      toast.error("Microphone access is required");
      return;
    }

    stopPreviewPlayback();
    audioRef.current?.pause();
    audioRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();

    shouldContinueRef.current = true;
    lastProcessedRef.current = { text: "", at: 0 };
    setCallState("listening");
    setTranscript([]);
    setCurrentInterim("");
    startListening();
  };

  // ─── LISTENING ───
  const startListening = useCallback(() => {
    if (!shouldContinueRef.current || isProcessingRef.current) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    let finalText = "";
    let silenceTimer: any = null;

    recognition.onresult = (event: any) => {
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = (event.results[i][0].transcript || "").trim();
        if (!t) continue;
        if (event.results[i].isFinal) {
          finalText = `${finalText} ${t}`.trim();
        } else {
          interim = `${interim} ${t}`.trim();
        }
      }

      const liveText = `${finalText} ${interim}`.trim();
      setCurrentInterim(liveText);

      clearTimeout(silenceTimer);
      if (finalText.trim()) {
        silenceTimer = setTimeout(() => {
          try { recognition.stop(); } catch {}
        }, 1200);
      }
    };

    recognition.onend = async () => {
      clearTimeout(silenceTimer);
      recognitionRef.current = null;
      const text = finalText.trim();

      if (text && shouldContinueRef.current) {
        const normalized = text.toLowerCase();
        const isRecentDuplicate =
          normalized === lastProcessedRef.current.text &&
          Date.now() - lastProcessedRef.current.at < 2500;

        if (!isRecentDuplicate) {
          lastProcessedRef.current = { text: normalized, at: Date.now() };
          setCurrentInterim("");
          await processUserInput(text);
          return;
        }
      }

      if (shouldContinueRef.current && !isProcessingRef.current) {
        setCurrentInterim("");
        setTimeout(() => startListening(), 150);
      }
    };

    recognition.onerror = (e: any) => {
      clearTimeout(silenceTimer);
      if (e.error === "no-speech" && shouldContinueRef.current) {
        setTimeout(() => startListening(), 200);
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
        if (shouldContinueRef.current) setTimeout(() => startListening(), 300);
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

  // Capture a frame from the active video source
  const captureFrame = (): string | undefined => {
    if (!canvasRef.current) return undefined;
    const sourceVideo = screenShareActive ? screenVideoRef.current : (videoActive ? videoRef.current : null);
    if (!sourceVideo || sourceVideo.videoWidth === 0) return undefined;
    const canvas = canvasRef.current;
    canvas.width = Math.min(sourceVideo.videoWidth, 640);
    canvas.height = Math.round(canvas.width * (sourceVideo.videoHeight / sourceVideo.videoWidth));
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  };

  const processUserInput = async (text: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    setTranscript(prev => [...prev, { role: "user", text, timestamp: new Date() }]);
    setCallState("thinking");

    try {
      const headers = await getAuthHeaders();
      let frameBase64 = captureFrame();
      const voiceId = selectedVoiceRef.current;

      if (!frameBase64 && (videoActive || screenShareActive)) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        frameBase64 = captureFrame();
      }

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-brain`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          question: text,
          mode: "full",
          voiceId,
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

      // Play audio response
      if (data.audio) {
        setCallState("speaking");
        await playAudioResponse(data.audio);
      } else if (data.text) {
        // Fallback if backend TTS is unavailable
        setCallState("speaking");
        await speakFallback(data.text, voiceId);
        isProcessingRef.current = false;
        if (shouldContinueRef.current) {
          setCallState("listening");
          startListening();
        }
      } else {
        isProcessingRef.current = false;
        if (shouldContinueRef.current) {
          setCallState("listening");
          startListening();
        }
      }
    } catch (e: any) {
      console.error("Voice brain error:", e);
      toast.error(e.message || "Failed to get response");
      isProcessingRef.current = false;
      if (shouldContinueRef.current) {
        setCallState("listening");
        startListening();
      }
    }
  };

  const playAudioResponse = (base64Audio: string): Promise<void> => {
    return new Promise((resolve) => {
      const audio = new Audio(`data:audio/mpeg;base64,${base64Audio}`);
      audioRef.current = audio;

      const finish = () => {
        audioRef.current = null;
        isProcessingRef.current = false;
        if (shouldContinueRef.current) {
          setCallState("listening");
          startListening();
        }
        resolve();
      };

      audio.onended = finish;
      audio.onerror = (e) => {
        console.error("Audio playback error:", e);
        finish();
      };

      audio.play().catch((err) => {
        console.error("Audio play() failed:", err);
        finish();
      });
    });
  };

  const cleanup = useCallback(() => {
    shouldContinueRef.current = false;
    isProcessingRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    audioRef.current?.pause();
    audioRef.current = null;
    stopPreviewPlayback();
    videoStreamRef.current?.getTracks().forEach(t => t.stop());
    videoStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setVideoActive(false);
    setScreenShareActive(false);
    setMicMuted(false);
    setCurrentInterim("");
    setPreviewPlaying(false);
  }, [stopPreviewPlayback]);

  // Video toggle
  const toggleVideo = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Camera is not supported on this browser");
      return;
    }

    if (videoActive) {
      videoStreamRef.current?.getTracks().forEach(t => t.stop());
      videoStreamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setVideoActive(false);
      return;
    }

    try {
      const candidates: MediaStreamConstraints[] = [
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: true },
      ];

      let stream: MediaStream | null = null;
      for (const constraints of candidates) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) break;
        } catch {
          // Try next candidate
        }
      }

      if (!stream) throw new Error("camera_unavailable");

      videoStreamRef.current = stream;
      setVideoActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Stop screen share if active
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
        if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
        setScreenShareActive(false);
      }
    } catch (err: any) {
      toast.error(err?.name === "NotAllowedError" ? "Camera access denied" : "Could not access camera");
    }
  };

  useEffect(() => {
    if (videoActive && videoRef.current && videoStreamRef.current) {
      videoRef.current.srcObject = videoStreamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [videoActive]);

  // Screen share toggle
  const toggleScreenShare = async () => {
    const canShareScreen = !!navigator.mediaDevices?.getDisplayMedia;
    if (!canShareScreen) {
      toast.error("Screen sharing is not supported on this device/browser");
      return;
    }

    if (screenShareActive) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
      setScreenShareActive(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      const [track] = stream.getVideoTracks();
      if (track) {
        track.onended = () => {
          screenStreamRef.current = null;
          if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
          setScreenShareActive(false);
        };
      }

      setScreenShareActive(true);

      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
        await screenVideoRef.current.play().catch(() => {});
      }

      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(t => t.stop());
        videoStreamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setVideoActive(false);
      }
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        toast.error("Screen share was cancelled");
      } else {
        toast.error("Screen sharing not available");
      }
    }
  };

  useEffect(() => {
    if (screenShareActive && screenVideoRef.current && screenStreamRef.current) {
      screenVideoRef.current.srcObject = screenStreamRef.current;
      screenVideoRef.current.play().catch(() => {});
    }
  }, [screenShareActive]);

  const toggleMic = () => {
    if (micMuted) {
      setMicMuted(false);
      if (callState === "listening") startListening();
    } else {
      setMicMuted(true);
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
        recognitionRef.current = null;
      }
    }
  };

  const handleEndCall = () => {
    const finalTranscript = transcriptRef.current;
    cleanup();
    if (finalTranscript.length > 0 && onCallEnd) {
      onCallEnd(finalTranscript);
    }
    setTranscript([]);
    setCallState("idle");
    onClose();
  };

  if (!open) return null;

  const isInCall = callState !== "idle" && callState !== "setup";
  const canShareScreen = !!navigator.mediaDevices?.getDisplayMedia;
  const showVideoFeed = videoActive || screenShareActive;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col">
      <canvas ref={canvasRef} className="hidden" />

      {/* ── SETUP SCREEN — centered card ── */}
      {callState === "setup" && (
        <>
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md" onClick={handleEndCall} />
          <div className="relative z-10 m-auto w-full max-w-lg mx-4 rounded-3xl border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-300">
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

              {/* Voice Selection */}
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
                    onClick={() => (previewPlaying ? stopPreviewPlayback() : previewVoice(selectedVoice))}
                    title={previewPlaying ? "Stop preview" : "Preview voice"}
                  >
                    {previewPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
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
                  I consent to audio/video capture. Transcripts will be saved to my chat history.
                </label>
              </div>

              <Button className="w-full h-12 text-base gap-2" onClick={startCall} disabled={!consentGiven}>
                <Phone className="h-5 w-5" /> Start Call
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ── IN-CALL: Gemini Live style — fullscreen ── */}
      {isInCall && (
        <div className="flex flex-col h-full w-full bg-black/95 relative">

          {/* Video Feed — fullscreen background */}
          {showVideoFeed && (
            <div className="absolute inset-0 z-0">
              {videoActive && (
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              )}
              {screenShareActive && (
                <video ref={screenVideoRef} autoPlay playsInline muted className="w-full h-full object-contain bg-black" />
              )}
            </div>
          )}

          {/* Top header bar */}
          <div className="relative z-10 flex items-center justify-between px-4 py-3 shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-white/90">
                <div className="flex gap-0.5">
                  <div className="w-0.5 h-3 bg-white/70 rounded-full animate-pulse" />
                  <div className="w-0.5 h-4 bg-white/70 rounded-full animate-pulse" style={{ animationDelay: "100ms" }} />
                  <div className="w-0.5 h-3 bg-white/70 rounded-full animate-pulse" style={{ animationDelay: "200ms" }} />
                </div>
                <span className="text-sm font-medium ml-1">Live</span>
              </div>
            </div>
            {/* Voice switch */}
            <div className="relative">
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="h-7 text-xs rounded-md bg-white/10 text-white border-white/20 border px-2 pr-6 appearance-none cursor-pointer focus:outline-none"
              >
                {VOICES.map(v => (
                  <option key={v.id} value={v.id} className="text-black">{v.name} ({v.gender})</option>
                ))}
              </select>
              <Volume2 className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none text-white/60" />
            </div>
          </div>

          {/* Transcript area — scrollable, takes remaining space */}
          <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-4 py-2" aria-live="polite">
            {/* Listening indicator at top when no transcript */}
            {transcript.length === 0 && !currentInterim && (
              <div className="flex flex-col items-center justify-center h-full">
                <div className="relative mb-4">
                  {callState === "listening" && (
                    <>
                      <div className="absolute inset-0 rounded-full bg-white/10 animate-ping" style={{ animationDuration: "2s" }} />
                      <div className="absolute -inset-3 rounded-full bg-white/5 animate-ping" style={{ animationDuration: "3s" }} />
                    </>
                  )}
                  <div className={`relative h-20 w-20 rounded-full flex items-center justify-center transition-all duration-500 ${
                    callState === "listening" ? "bg-white/10 ring-4 ring-white/20" :
                    callState === "thinking" ? "bg-white/5" :
                    callState === "speaking" ? "bg-white/15 ring-4 ring-white/30" : "bg-white/5"
                  }`}>
                    {callState === "listening" && <Mic className="h-8 w-8 text-white" />}
                    {callState === "thinking" && <Loader2 className="h-8 w-8 text-white animate-spin" />}
                    {callState === "speaking" && (
                      <div className="flex items-end gap-1 h-8">
                        {[0, 1, 2, 3, 4].map(i => (
                          <div key={i} className="w-1.5 bg-white rounded-full animate-bounce"
                            style={{ height: `${10 + Math.random() * 22}px`, animationDelay: `${i * 100}ms`, animationDuration: "0.6s" }} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-white/90 text-sm font-medium">
                  {callState === "listening" ? "Listening..." : callState === "thinking" ? "Thinking..." : callState === "speaking" ? "Speaking..." : ""}
                </p>
                <p className="text-white/50 text-xs mt-1">Speak naturally — I'm ready</p>
              </div>
            )}

            {/* Chat bubbles */}
            {(transcript.length > 0 || currentInterim) && (
              <div className="space-y-3 pb-4">
                {transcript.map((entry, i) => (
                  <div key={i} className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                      entry.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-white/10 text-white backdrop-blur-sm"
                    }`}>
                      {entry.text}
                    </div>
                  </div>
                ))}

                {/* Current interim text */}
                {currentInterim && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm bg-primary/60 text-primary-foreground italic">
                      {currentInterim}
                    </div>
                  </div>
                )}

                {/* Thinking indicator */}
                {callState === "thinking" && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl px-4 py-2.5 bg-white/10 text-white backdrop-blur-sm">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="w-2 h-2 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="w-2 h-2 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Speaking indicator */}
                {callState === "speaking" && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl px-4 py-2.5 bg-white/10 backdrop-blur-sm flex items-center gap-2">
                      <div className="flex items-end gap-0.5 h-4">
                        {[0, 1, 2, 3].map(i => (
                          <div key={i} className="w-1 bg-white/70 rounded-full animate-bounce"
                            style={{ height: `${6 + Math.random() * 10}px`, animationDelay: `${i * 80}ms`, animationDuration: "0.5s" }} />
                        ))}
                      </div>
                      <span className="text-white/60 text-xs">Speaking...</span>
                    </div>
                  </div>
                )}

                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>

          {/* Bottom Controls — Gemini Live style */}
          <div className="relative z-10 shrink-0 pb-8 pt-4 flex justify-center">
            <div className="flex items-center gap-4">
              {/* Video toggle */}
              <button onClick={toggleVideo}
                className={`h-14 w-14 rounded-full flex items-center justify-center transition-all border-2 ${
                  videoActive ? "bg-white text-black border-white" : "bg-white/10 text-white border-white/20 hover:bg-white/20"
                }`}
                title={videoActive ? "Turn off camera" : "Turn on camera"}
              >
                {videoActive ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
              </button>

              {/* Screen share */}
              <button onClick={toggleScreenShare}
                disabled={!canShareScreen}
                className={`h-14 w-14 rounded-full flex items-center justify-center transition-all border-2 ${
                  !canShareScreen
                    ? "bg-white/5 text-white/40 border-white/10 cursor-not-allowed"
                    : screenShareActive
                      ? "bg-white text-black border-white"
                      : "bg-white/10 text-white border-white/20 hover:bg-white/20"
                }`}
                title={!canShareScreen ? "Screen sharing unsupported on this device" : screenShareActive ? "Stop sharing" : "Share screen"}
              >
                {screenShareActive ? <Monitor className="h-6 w-6" /> : <MonitorOff className="h-6 w-6" />}
              </button>

              {/* Mic toggle */}
              <button onClick={toggleMic}
                className={`h-14 w-14 rounded-full flex items-center justify-center transition-all border-2 ${
                  micMuted ? "bg-red-500/20 text-red-400 border-red-500/40" : "bg-white/10 text-white border-white/20 hover:bg-white/20"
                }`}
                title={micMuted ? "Unmute" : "Mute"}
              >
                {micMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </button>

              {/* End call */}
              <button onClick={handleEndCall}
                className="h-14 w-14 rounded-full flex items-center justify-center bg-red-600 text-white hover:bg-red-700 transition-all border-2 border-red-500"
                title="End call"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Call ended */}
      {callState === "idle" && (
        <>
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />
          <div className="relative z-10 m-auto w-full max-w-lg mx-4 rounded-3xl border bg-card shadow-2xl p-6 text-center space-y-4">
            <Brain className="h-12 w-12 mx-auto text-primary/40" />
            <p className="text-sm text-muted-foreground">Call ended — transcript saved to chat</p>
            <Button onClick={() => setCallState("setup")} variant="outline">Start New Call</Button>
          </div>
        </>
      )}
    </div>
  );
}
