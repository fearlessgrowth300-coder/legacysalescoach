import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Phone, PhoneOff, Send, Loader2, Star, Target, Lightbulb,
  MessageSquare, Trophy, RotateCcw, ChevronRight, Sparkles, Mic,
  Clock, Gamepad2, Search, Handshake, Award, AlertTriangle,
  TrendingUp, BarChart3, CheckCircle2, XCircle, ArrowLeft, User,
  Shield, Diamond, Info, Zap, BookOpen, History, ChartLine,
  Radio, Volume2, MicOff, Headphones, PhoneCall, Brain
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";

// ============================================
// SCENARIO DATA
// ============================================
const SCENARIO_CATEGORIES = [
  { id: "all", label: "All Scenarios", icon: Gamepad2 },
  { id: "opening", label: "Opening", icon: Phone },
  { id: "discovery", label: "Discovery", icon: Search },
  { id: "closing", label: "Closing", icon: Handshake },
  { id: "challenge", label: "Challenge", icon: Award },
];

type Difficulty = "Easy" | "Medium" | "Hard";

type ProspectGender = "male" | "female";

type RichScenario = {
  id: string;
  name: string;
  category: string;
  difficulty: Difficulty;
  duration: string;
  description: string;
  prospectName: string;
  prospectRole: string;
  prospectCompany: string;
  prospectPersonality: string;
  prospectGender: ProspectGender;
  objectives: string[];
  examplePhrases?: string[];
  successMetrics?: string[];
  commonMistakes?: string[];
  expectedObjections?: string[];
};

// ElevenLabs voice mapping by gender
const ELEVENLABS_VOICES: Record<ProspectGender, { id: string; name: string }[]> = {
  male: [
    { id: "JBFqnCBsd6RMkjVDRZzb", name: "George" },
    { id: "iP95p4xoKVk53GoZ742B", name: "Chris" },
    { id: "nPczCjzI2devNBz1zQrb", name: "Brian" },
  ],
  female: [
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" },
    { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura" },
    { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica" },
  ],
};

function getVoiceForScenario(scenario: RichScenario): string {
  const voices = ELEVENLABS_VOICES[scenario.prospectGender];
  const hash = scenario.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return voices[hash % voices.length].id;
}

const RICH_SCENARIOS: RichScenario[] = [
  // OPENING
  {
    id: "cold_call_easy", name: "Cold Call - Easy Mode", category: "opening", difficulty: "Easy", duration: "3 min",
    description: "Practice cold calling with Jenna, an ops manager who got burned by a vendor 6 months ago.",
    prospectName: "Jenna", prospectRole: "Operations Manager", prospectCompany: "Apex Solutions",
    prospectGender: "female",
    prospectPersonality: "Cautious but open-minded. Had a bad vendor experience recently.",
    objectives: ["Build initial rapport", "Identify a pain point quickly", "Get permission to continue"],
    expectedObjections: ["We already have a solution", "I got burned last time", "Send me an email instead"],
  },
  {
    id: "cold_call_b2b", name: "Cold Call (B2B)", category: "opening", difficulty: "Hard", duration: "5 min",
    description: "Advanced cold calling with Tom, a procurement drill sergeant who gives you 30 seconds.",
    prospectName: "Tom", prospectRole: "Procurement Manager", prospectCompany: "Sterling Industries",
    prospectGender: "male",
    prospectPersonality: "Aggressive, time-conscious, alpha-type. Will cut you off fast.",
    objectives: ["Hook within 10 seconds", "Earn the right to continue", "Schedule a follow-up"],
    expectedObjections: ["I don't take cold calls", "You have 30 seconds", "We're locked into a contract"],
  },
  {
    id: "cold_dm_approach", name: "Cold DM Approach", category: "opening", difficulty: "Easy", duration: "3 min",
    description: "You found a prospect on Instagram. Start a conversation naturally without being salesy.",
    prospectName: "Sarah", prospectRole: "Online Store Owner", prospectCompany: "Self-employed",
    prospectGender: "female",
    prospectPersonality: "Gets DMs from salespeople daily. Only engages if it feels genuine.",
    objectives: ["Start naturally", "Show genuine interest", "Transition to business without being pushy"],
  },
  {
    id: "network_marketing_invite", name: "Network Marketing Invite", category: "opening", difficulty: "Medium", duration: "4 min",
    description: "Invite a warm contact to look at your business opportunity without triggering 'pyramid scheme' alarm.",
    prospectName: "Mike", prospectRole: "Office Worker", prospectCompany: "Corporate job, 9-5",
    prospectGender: "male",
    prospectPersonality: "Friend/acquaintance. Slightly negative about MLM. Will ask 'is this a pyramid scheme?'",
    objectives: ["Approach with genuine care", "Pique curiosity without overselling", "Get them to look at a presentation"],
    commonMistakes: ["Pitching too hard too fast", "Getting defensive about 'pyramid scheme'", "Overselling the income"],
  },
  // DISCOVERY
  {
    id: "consultative_selling", name: "Consultative Selling", category: "discovery", difficulty: "Medium", duration: "5 min",
    description: "Guide Kwame to discover his own problems — he knows something's wrong but can't articulate it.",
    prospectName: "Kwame", prospectRole: "Operations Lead", prospectCompany: "Harmon & Associates",
    prospectGender: "male",
    prospectPersonality: "Thoughtful, needs time to process. Knows there's a problem but can't name it.",
    objectives: ["Use open-ended questions", "Help them articulate their pain", "Don't pitch until they self-discover"],
    examplePhrases: ["Walk me through your typical day when [problem area] comes up...", "What happens when that doesn't get handled?", "How long has that been going on?"],
  },
  {
    id: "focus_on_prospect", name: "Focus on Prospect", category: "discovery", difficulty: "Medium", duration: "4 min",
    description: "Practice active listening with Clara who rapid-fires pains. Mirror and reflect without pitching early.",
    prospectName: "Clara", prospectRole: "VP of Sales", prospectCompany: "Velocity Partners",
    prospectGender: "female",
    prospectPersonality: "Fast talker, shares lots of problems at once. Tests if you listen or just pitch.",
    objectives: ["Mirror their language", "Prioritize their pains", "Resist the urge to pitch"],
  },
  {
    id: "follow_up_call", name: "Follow Up Call", category: "discovery", difficulty: "Medium", duration: "4 min",
    description: "Follow up with someone who said 'let me think about it' last week. Re-engage without being pushy.",
    prospectName: "Rachel", prospectRole: "Marketing Director", prospectCompany: "BrightWave Digital",
    prospectGender: "female",
    prospectPersonality: "Said she'd think about it but forgot. Not hostile but needs re-engagement.",
    objectives: ["Re-establish rapport", "Discover what held them back", "Create new urgency"],
  },
  {
    id: "referral_ask", name: "Ask for Referrals", category: "discovery", difficulty: "Easy", duration: "3 min",
    description: "Your happy customer just got great results. Ask them for referrals naturally.",
    prospectName: "David", prospectRole: "Happy Customer", prospectCompany: "Your existing client",
    prospectGender: "male",
    prospectPersonality: "Loves your product but never thought about referring. Needs guidance.",
    objectives: ["Anchor to their success", "Make referring easy", "Get specific names"],
  },
  // CLOSING
  {
    id: "objection_price", name: "Handle Price Objection", category: "closing", difficulty: "Hard", duration: "5 min",
    description: "The prospect loves your product but says it's too expensive. Reframe value without discounting.",
    prospectName: "Derek", prospectRole: "Head of Sales Enablement", prospectCompany: "Catalyst Media Group",
    prospectGender: "male",
    prospectPersonality: "Genuinely likes it but gut reaction is 'too expensive'. Push back 2-3 times.",
    objectives: ["Reframe cost as investment", "Quantify the ROI", "Create urgency to act now"],
    examplePhrases: ["I hear you on the price. Let me ask — what's it costing you right now to NOT solve this?", "If this saves you [X hours/dollars] per month, when does it pay for itself?"],
  },
  {
    id: "renewal_save", name: "Renewal Save", category: "closing", difficulty: "Hard", duration: "5 min",
    description: "Save an at-risk renewal with Derek, a frustrated customer whose team hasn't fully adopted your product.",
    prospectName: "Derek", prospectRole: "Head of Sales Enablement", prospectCompany: "Catalyst Media Group",
    prospectGender: "male",
    prospectPersonality: "Frustrated, feels let down. Considering churning.",
    objectives: ["Acknowledge frustration", "Identify adoption blockers", "Propose a success plan"],
  },
  {
    id: "saas_pricing", name: "SaaS Pricing & Procurement", category: "closing", difficulty: "Hard", duration: "5 min",
    description: "Post-demo, pre-close. Linda from procurement says your pricing is 'higher than expected' and brings up competitors.",
    prospectName: "Linda", prospectRole: "Head of Procurement", prospectCompany: "Quantum Dynamics",
    prospectGender: "female",
    prospectPersonality: "Professional, analytical. Uses competitor pricing as leverage.",
    objectives: ["Defend value without discounting", "Differentiate from competitors", "Move toward contract"],
  },
  {
    id: "enterprise_multi_stakeholder", name: "Enterprise Multi-Stakeholder", category: "closing", difficulty: "Hard", duration: "6 min",
    description: "Buying committee alignment call. Chris has the CFO worried about ROI and IT worried about security.",
    prospectName: "Chris", prospectRole: "VP of Operations (Your Champion)", prospectCompany: "Horizon Financial",
    prospectGender: "male",
    prospectPersonality: "On your side but can't push it through alone. Needs help aligning stakeholders.",
    objectives: ["Address CFO's ROI concerns", "Handle IT's security objections", "Align all stakeholders"],
  },
  // CHALLENGE
  {
    id: "sell_pen", name: "Sell To The Wolf", category: "challenge", difficulty: "Hard", duration: "2 min",
    description: "The classic 'sell me this pen' challenge with Jordan, an aggressive stock broker.",
    prospectName: "Jordan", prospectRole: "Stock Broker", prospectCompany: "Wall Street Securities",
    prospectGender: "male",
    prospectPersonality: "Aggressive, money-focused, impatient, alpha-type Wall Street personality.",
    objectives: ["Identify buying signals", "Create urgency appropriately", "Close with confidence"],
    examplePhrases: ['Problem: "What happens when you\'re in that 5pm meeting and need to jot down that critical action item?"', 'Solution: "You need reliable capture in any situation"', 'Trial close: "If this prevents the 5pm scramble, worth trying?"'],
    successMetrics: ["Emotion acknowledged by prospect", 'Vivid "moment of use" painted', "Need-payoff verbalized by prospect"],
    commonMistakes: ["Starting with specs/features", "No emotional stakes established", "Long explanations instead of quick hooks"],
    expectedObjections: ["I have a dozen Mont Blanc pens already", "Last pen I bought cost me $800 — I lost it in a week", "I go through pens like water during high-stress trades"],
  },
  {
    id: "product_demo", name: "Product Demo Pitch", category: "challenge", difficulty: "Medium", duration: "5 min",
    description: "Demo your product to a skeptical decision-maker who's seen 10 demos this week.",
    prospectName: "Alex", prospectRole: "CTO", prospectCompany: "NovaTech Solutions",
    prospectGender: "male",
    prospectPersonality: "Tech-savvy, demo-fatigued, wants to see something different.",
    objectives: ["Lead with their specific problem", "Show, don't tell", "Get a verbal commitment"],
  },
  {
    id: "team_building", name: "Team Building Pitch", category: "challenge", difficulty: "Medium", duration: "5 min",
    description: "Recruit a potential team member to join your business. They're talented but risk-averse.",
    prospectName: "Lisa", prospectRole: "Senior Sales Rep", prospectCompany: "Currently employed, stable job",
    prospectGender: "female",
    prospectPersonality: "Great at sales, curious about entrepreneurship, but fears instability.",
    objectives: ["Paint the vision", "Address fear of instability", "Show a realistic path to success"],
    commonMistakes: ["Overselling income potential", "Dismissing their concerns", "Making it sound too easy"],
  },
];

// ============================================
// TYPES
// ============================================
type Message = {
  role: "user" | "assistant";
  content: string;
  coaching?: {
    coachFeedback: string;
    techniqueUsed: string;
    score: number;
    tips: string[];
    conversationStage: string;
  };
};

type PhoneAnalysis = {
  overallScore: number;
  scoreLabel: string;
  scoreMessage: string;
  sections: Array<{ name: string; icon: string; score: number; feedback: string }>;
  highlightReel: {
    bestMoment: { quote: string; timestamp: string; explanation: string };
    needsWork: { quote: string; timestamp: string; explanation: string };
  };
  keyTakeaways: { didWell: string[]; focusAreas: string[] };
  objectionReplay: Array<{ objection: string; response: string; handled: boolean }>;
  callAnalytics: {
    talkListenRatio: number;
    talkSpeed: number;
    longestMonologue: string;
    objectionsHandled: string;
    userWordCount: number;
    prospectWordCount: number;
  };
};

type LiveCoaching = {
  currentSituation: string;
  suggestions: Array<{ type: string; priority: string; text: string; reason: string }>;
  objectionDetected: string | null;
  objectionHandler: string | null;
  toneAdvice: string;
  stageDetected: string;
};

type CallState = "idle" | "scenario_detail" | "ringing" | "connected" | "ended" | "voice_ringing" | "voice_connected" | "voice_ended" | "live_assist";

const difficultyColor: Record<Difficulty, string> = {
  Easy: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Hard: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

// ============================================
// COMPONENT
// ============================================
export default function PracticeCall() {
  const { user } = useAuth();
  const [callState, setCallState] = useState<CallState>("idle");
  const [selectedScenario, setSelectedScenario] = useState<RichScenario | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [overallScore, setOverallScore] = useState(0);
  const [businessContext, setBusinessContext] = useState("");
  const [showBusinessSetup, setShowBusinessSetup] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState("scene");
  const [allScores, setAllScores] = useState<number[]>([]);
  const [allFeedback, setAllFeedback] = useState<string[]>([]);
  const [allTechniques, setAllTechniques] = useState<string[]>([]);
  const [allStages, setAllStages] = useState<string[]>([]);
  const [phoneAnalysis, setPhoneAnalysis] = useState<PhoneAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [topTab, setTopTab] = useState<"practice" | "results" | "progress" | "live_calls">("practice");
  const [pastSessions, setPastSessions] = useState<any[]>([]);
  const [loadingPast, setLoadingPast] = useState(false);
  const [learnContent, setLearnContent] = useState<any>(null);
  const [loadingLearn, setLoadingLearn] = useState(false);
  const [companyProfile, setCompanyProfile] = useState<any>(null);

  // Voice practice state
  const [voiceTranscript, setVoiceTranscript] = useState<Array<{ role: string; text: string; timestamp: string }>>([]);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);

  // Live call assist state
  const [liveTranscript, setLiveTranscript] = useState<Array<{ speaker: string; text: string; timestamp: string }>>([]);
  const [liveCoaching, setLiveCoaching] = useState<LiveCoaching | null>(null);
  const [liveListening, setLiveListening] = useState(false);
  const [loadingCoaching, setLoadingCoaching] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveRecognitionRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [voiceTranscript, liveTranscript]);

  // Load profile & company
  useEffect(() => {
    if (!user) return;
    supabase.from("company_profiles").select("*").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => { if (data) setCompanyProfile(data); });
  }, [user]);

  // Load past sessions
  const loadPastSessions = useCallback(async () => {
    if (!user) return;
    setLoadingPast(true);
    const { data } = await supabase
      .from("practice_call_sessions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setPastSessions(data || []);
    setLoadingPast(false);
  }, [user]);

  useEffect(() => {
    if (topTab === "results" || topTab === "progress") loadPastSessions();
  }, [topTab, loadPastSessions]);

  // Generate learn content from Brain
  const generateLearnContent = useCallback(async (scenario: RichScenario) => {
    setLoadingLearn(true);
    setLearnContent(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-scenario-learn", {
        body: {
          scenarioName: scenario.name,
          scenarioDescription: scenario.description,
          scenarioCategory: scenario.category,
          prospectName: scenario.prospectName,
          prospectRole: scenario.prospectRole,
          prospectPersonality: scenario.prospectPersonality,
          objectives: scenario.objectives,
        },
      });
      if (error) throw error;
      setLearnContent(data);
    } catch (e: any) {
      toast.error("Failed to generate learning content: " + (e.message || ""));
    } finally {
      setLoadingLearn(false);
    }
  }, []);

  // ============================================
  // VOICE PRACTICE LOGIC (Browser-based)
  // ============================================
  const getBusinessContextString = useCallback(() => {
    if (companyProfile) {
      return `Company: ${companyProfile.company_name}. Selling: ${companyProfile.what_selling || "N/A"}. Target: ${companyProfile.target_audience || "N/A"}. Pain points: ${companyProfile.pain_points || "N/A"}. Objections: ${companyProfile.objections || "N/A"}.`;
    }
    return businessContext || undefined;
  }, [companyProfile, businessContext]);

  const speakText = useCallback((text: string, gender: ProspectGender = "male"): Promise<void> => {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = gender === "female" ? 1.1 : 0.9;
      const voices = window.speechSynthesis.getVoices();
      const genderVoice = gender === "female"
        ? voices.find(v => v.name.includes("Female") || v.name.includes("Samantha") || v.name.includes("Victoria") || v.name.includes("Karen") || v.name.includes("Zira"))
        : voices.find(v => v.name.includes("Male") || v.name.includes("Daniel") || v.name.includes("James") || v.name.includes("David"));
      if (genderVoice) utterance.voice = genderVoice;
      utterance.onend = () => { setIsSpeaking(false); resolve(); };
      utterance.onerror = () => { setIsSpeaking(false); resolve(); };
      synthRef.current = utterance;
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    });
  }, []);

  const startListening = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) { reject("Speech recognition not supported"); return; }
      
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";
      recognitionRef.current = recognition;
      
      let result = "";
      recognition.onresult = (event: any) => {
        result = event.results[0][0].transcript;
      };
      recognition.onend = () => {
        setIsListening(false);
        resolve(result);
      };
      recognition.onerror = (event: any) => {
        setIsListening(false);
        if (event.error === "no-speech") resolve("");
        else reject(event.error);
      };
      
      setIsListening(true);
      recognition.start();
    });
  }, []);

  const voiceConversationLoop = useCallback(async (scenario: RichScenario, transcript: Array<{ role: string; text: string; timestamp: string }>, sessionId: string) => {
    // Listen for user speech
    try {
      const userSpeech = await startListening();
      if (!userSpeech.trim()) {
        // No speech detected, try again
        if (callState === "voice_connected") {
          setTimeout(() => voiceConversationLoop(scenario, transcript, sessionId), 500);
        }
        return;
      }

      // Add user speech to transcript
      const newTranscript = [...transcript, { role: "user", text: userSpeech, timestamp: new Date().toISOString() }];
      setVoiceTranscript(newTranscript);

      // Send to AI
      const history = newTranscript.map(t => ({ role: t.role, content: t.text }));
      const { data, error } = await supabase.functions.invoke("practice-call", {
        body: {
          action: "respond",
          scenarioId: scenario.id,
          messages: history,
          businessContext: getBusinessContextString(),
          customScenario: {
            name: scenario.name,
            description: scenario.description,
            persona: `You are ${scenario.prospectName}, ${scenario.prospectRole} at ${scenario.prospectCompany}. Personality: ${scenario.prospectPersonality}`,
          },
        },
      });
      if (error) throw error;

      const aiText = data.prospectResponse || "Could you say that again?";
      const updatedTranscript = [...newTranscript, { role: "assistant", text: aiText, timestamp: new Date().toISOString() }];
      setVoiceTranscript(updatedTranscript);

      // Update session in DB
      await supabase.from("practice_call_sessions")
        .update({ transcript: updatedTranscript, status: "in-progress" })
        .eq("id", sessionId);

      // Speak AI response
      await speakText(aiText, scenario.prospectGender);

      // Check if conversation ended
      if (data.conversationStage === "won" || data.conversationStage === "lost") {
        setCallState("voice_ended");
        if (callTimerRef.current) clearInterval(callTimerRef.current);
        // Trigger analysis
        analyzeVoiceCall(updatedTranscript, sessionId);
        return;
      }

      // Continue loop
      voiceConversationLoop(scenario, updatedTranscript, sessionId);
    } catch (e: any) {
      if (e === "aborted" || e === "not-allowed") return;
      console.error("Voice loop error:", e);
      // Retry after brief pause
      setTimeout(() => voiceConversationLoop(scenario, transcript, sessionId), 1000);
    }
  }, [startListening, speakText, getBusinessContextString]);

  const startVoiceCall = useCallback(async () => {
    if (!selectedScenario || !user) return;
    
    // Request mic permission
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop()); // Release immediately, SpeechRecognition will handle it
    } catch {
      toast.error("Microphone access is required for voice practice.");
      return;
    }

    setCallState("voice_ringing");
    setVoiceTranscript([]);
    setPhoneAnalysis(null);
    setCallDuration(0);

    // Create session in DB
    const { data: session, error: sessionError } = await supabase
      .from("practice_call_sessions")
      .insert({
        user_id: user.id,
        scenario_id: selectedScenario.id,
        scenario_name: selectedScenario.name,
        phone_number: "browser-voice",
        status: "initiating",
        transcript: [],
      })
      .select("id")
      .single();

    if (sessionError) {
      toast.error("Failed to create session");
      setCallState("scenario_detail");
      return;
    }

    setVoiceSessionId(session.id);

    // Simulate ringing for 2s then connect
    setTimeout(async () => {
      setCallState("voice_connected");

      // Start call timer
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);

      // Get AI opening line
      try {
        const { data, error } = await supabase.functions.invoke("practice-call", {
          body: {
            action: "start",
            scenarioId: selectedScenario.id,
            businessContext: getBusinessContextString(),
            customScenario: {
              name: selectedScenario.name,
              description: selectedScenario.description,
              persona: `You are ${selectedScenario.prospectName}, ${selectedScenario.prospectRole} at ${selectedScenario.prospectCompany}. Personality: ${selectedScenario.prospectPersonality}`,
            },
          },
        });
        if (error) throw error;

        const aiText = data.prospectResponse || "Hello?";
        const initialTranscript = [{ role: "assistant" as const, text: aiText, timestamp: new Date().toISOString() }];
        setVoiceTranscript(initialTranscript);

        // Update DB
        await supabase.from("practice_call_sessions")
          .update({ transcript: initialTranscript, status: "in-progress" })
          .eq("id", session.id);

        // Speak the opening line
        await speakText(aiText, selectedScenario.prospectGender);

        // Start conversation loop
        voiceConversationLoop(selectedScenario, initialTranscript, session.id);
      } catch (e: any) {
        toast.error("Failed to start: " + (e.message || ""));
        setCallState("scenario_detail");
      }
    }, 2000);
  }, [selectedScenario, user, speakText, voiceConversationLoop, getBusinessContextString]);

  const endVoiceCall = useCallback(() => {
    // Stop everything
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }
    window.speechSynthesis.cancel();
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    setIsListening(false);
    setIsSpeaking(false);
    setCallState("voice_ended");

    // Trigger analysis
    if (voiceTranscript.length > 0 && voiceSessionId) {
      analyzeVoiceCall(voiceTranscript, voiceSessionId);
    }
  }, [voiceTranscript, voiceSessionId]);

  const analyzeVoiceCall = useCallback(async (transcript: Array<{ role: string; text: string; timestamp: string }>, sessionId: string) => {
    if (transcript.length === 0 || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-phone-call", {
        body: {
          sessionId,
          transcript,
          scenarioName: selectedScenario?.name,
          prospectName: selectedScenario?.prospectName,
          prospectRole: selectedScenario?.prospectRole,
          prospectCompany: selectedScenario?.prospectCompany,
        },
      });
      if (error) throw error;
      setPhoneAnalysis(data);
    } catch (e: any) {
      console.error("Analysis failed:", e);
      toast.error("Coaching analysis failed. You can still review your transcript.");
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedScenario, isAnalyzing]);

  // ============================================
  // LIVE CALL ASSISTANCE LOGIC
  // ============================================
  const startLiveAssist = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch {
      toast.error("Microphone access is required for live call assistance.");
      return;
    }

    setCallState("live_assist");
    setLiveTranscript([]);
    setLiveCoaching(null);
    setLiveListening(true);

    // Start continuous recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    liveRecognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      const lastResult = event.results[event.results.length - 1];
      if (lastResult.isFinal) {
        const text = lastResult[0].transcript.trim();
        if (text) {
          setLiveTranscript(prev => [...prev, { speaker: "Call", text, timestamp: new Date().toISOString() }]);
        }
      }
    };

    recognition.onend = () => {
      // Restart if still in live assist mode
      if (liveRecognitionRef.current) {
        try { recognition.start(); } catch {}
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.error("Live recognition error:", event.error);
      }
    };

    recognition.start();
  }, []);

  const stopLiveAssist = useCallback(() => {
    if (liveRecognitionRef.current) {
      try { liveRecognitionRef.current.abort(); } catch {}
      liveRecognitionRef.current = null;
    }
    setLiveListening(false);
    setCallState("idle");
  }, []);

  // Fetch coaching when transcript updates
  useEffect(() => {
    if (callState !== "live_assist" || liveTranscript.length === 0) return;
    // Debounce: only fetch every 3 entries or every 10 seconds
    if (liveTranscript.length % 3 !== 0) return;

    const fetchCoaching = async () => {
      setLoadingCoaching(true);
      try {
        const { data, error } = await supabase.functions.invoke("live-call-assist", {
          body: {
            transcript: liveTranscript.slice(-10),
            businessContext: getBusinessContextString(),
          },
        });
        if (error) throw error;
        setLiveCoaching(data);
      } catch (e) {
        console.error("Coaching fetch error:", e);
      } finally {
        setLoadingCoaching(false);
      }
    };
    fetchCoaching();
  }, [liveTranscript, callState, getBusinessContextString]);

  // ============================================
  // TEXT PRACTICE LOGIC (kept from original)
  // ============================================
  const filteredScenarios = activeCategory === "all"
    ? RICH_SCENARIOS
    : RICH_SCENARIOS.filter(s => s.category === activeCategory);

  const openScenarioDetail = (scenario: RichScenario) => {
    setSelectedScenario(scenario);
    setCallState("scenario_detail");
    setActiveDetailTab("scene");
    setLearnContent(null);
  };

  const startCall = async () => {
    if (!selectedScenario) return;
    setCallState("ringing");
    setMessages([]);
    setOverallScore(0);
    setAllScores([]);
    setAllFeedback([]);
    setAllTechniques([]);
    setAllStages([]);

    setTimeout(async () => {
      setCallState("connected");
      setIsLoading(true);

      try {
        const { data, error } = await supabase.functions.invoke("practice-call", {
          body: {
            action: "start",
            scenarioId: selectedScenario.id,
            businessContext: getBusinessContextString(),
            customScenario: {
              name: selectedScenario.name,
              description: selectedScenario.description,
              persona: `You are ${selectedScenario.prospectName}, ${selectedScenario.prospectRole} at ${selectedScenario.prospectCompany}. Personality: ${selectedScenario.prospectPersonality}`,
            },
          },
        });
        if (error) throw error;

        const score = data.score || 5;
        setAllScores([score]);
        setAllFeedback([data.coachFeedback || ""]);
        setAllStages([data.conversationStage || "opening"]);

        setMessages([{
          role: "assistant",
          content: data.prospectResponse,
          coaching: {
            coachFeedback: data.coachFeedback,
            techniqueUsed: data.techniqueUsed || "none",
            score,
            tips: data.tips || [],
            conversationStage: data.conversationStage || "opening",
          },
        }]);
      } catch (e: any) {
        toast.error("Failed to start: " + (e.message || "Unknown error"));
        setCallState("scenario_detail");
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    }, 2000);
  };

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading || callState !== "connected") return;

    const userMessage: Message = { role: "user", content: inputText.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);

    try {
      const history = [...messages, userMessage].map(m => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke("practice-call", {
        body: {
          action: "respond",
          scenarioId: selectedScenario?.id,
          messages: history,
          businessContext: getBusinessContextString(),
          customScenario: selectedScenario ? {
            name: selectedScenario.name,
            description: selectedScenario.description,
            persona: `You are ${selectedScenario.prospectName}, ${selectedScenario.prospectRole} at ${selectedScenario.prospectCompany}. Personality: ${selectedScenario.prospectPersonality}`,
          } : undefined,
        },
      });
      if (error) throw error;

      const score = data.score || 5;
      setAllScores(prev => [...prev, score]);
      setAllFeedback(prev => [...prev, data.coachFeedback || ""]);
      if (data.techniqueUsed && data.techniqueUsed !== "none" && data.techniqueUsed !== "none detected") {
        setAllTechniques(prev => [...prev, data.techniqueUsed]);
      }
      setAllStages(prev => [...prev, data.conversationStage || "opening"]);
      setOverallScore(Math.round(([...allScores, score].reduce((a, b) => a + b, 0)) / ([...allScores, score].length)));

      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.prospectResponse,
        coaching: {
          coachFeedback: data.coachFeedback,
          techniqueUsed: data.techniqueUsed || "none",
          score,
          tips: data.tips || [],
          conversationStage: data.conversationStage || "opening",
        },
      }]);

      if (data.conversationStage === "won" || data.conversationStage === "lost") {
        setCallState("ended");
      }
    } catch (e: any) {
      toast.error("Error: " + (e.message || "Unknown error"));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const endCall = () => setCallState("ended");

  const resetCall = () => {
    setCallState("idle");
    setSelectedScenario(null);
    setMessages([]);
    setOverallScore(0);
    setVoiceTranscript([]);
    setPhoneAnalysis(null);
    setVoiceSessionId(null);
    setCallDuration(0);
  };

  const backToScenarios = () => {
    setCallState("idle");
    setSelectedScenario(null);
  };

  const getStageColor = (stage: string) => {
    const colors: Record<string, string> = {
      opening: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
      rapport: "bg-green-500/20 text-green-600 dark:text-green-400",
      discovery: "bg-purple-500/20 text-purple-600 dark:text-purple-400",
      presentation: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
      objection: "bg-red-500/20 text-red-600 dark:text-red-400",
      closing: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
      won: "bg-green-500/20 text-green-600 dark:text-green-400",
      lost: "bg-red-500/20 text-red-600 dark:text-red-400",
    };
    return colors[stage] || "bg-muted text-muted-foreground";
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return "text-emerald-600 dark:text-emerald-400";
    if (score >= 5) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  // ========================
  // LIVE CALL ASSIST STATE
  // ========================
  if (callState === "live_assist") {
    return (
      <div className="px-4 py-6 max-w-5xl mx-auto overflow-x-hidden">
        <button onClick={stopLiveAssist} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" />End Assistance
        </button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Radio className="h-6 w-6 text-red-500 animate-pulse" />
              Live Call Assistance
            </h1>
            <p className="text-sm text-muted-foreground mt-1">AI coaching active — speak naturally, suggestions appear in real-time</p>
          </div>
          <Button variant="destructive" onClick={stopLiveAssist}>
            <PhoneOff className="h-4 w-4 mr-2" />End
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Live Transcript */}
          <Card className="lg:row-span-2">
            <CardContent className="py-4">
              <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                <Mic className="h-4 w-4 text-red-500" />
                <span>Live Transcript</span>
                {liveListening && (
                  <span className="flex items-center gap-1 text-xs text-red-500">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />Listening
                  </span>
                )}
              </h3>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {liveTranscript.length === 0 ? (
                    <div className="text-center py-12">
                      <Headphones className="h-10 w-10 mx-auto text-muted-foreground/50 animate-pulse mb-3" />
                      <p className="text-sm text-muted-foreground">Start your sales call — I'm listening and will provide coaching in real-time.</p>
                    </div>
                  ) : (
                    liveTranscript.map((entry, i) => (
                      <div key={i} className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1">{new Date(entry.timestamp).toLocaleTimeString()}</p>
                        <p className="text-sm">{entry.text}</p>
                      </div>
                    ))
                  )}
                  <div ref={transcriptEndRef} />
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Coaching Suggestions */}
          <Card className="border-primary/20">
            <CardContent className="py-4">
              <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                AI Coaching
                {loadingCoaching && <Loader2 className="h-3 w-3 animate-spin" />}
              </h3>
              {liveCoaching ? (
                <div className="space-y-3">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">What's happening:</p>
                    <p className="text-sm">{liveCoaching.currentSituation}</p>
                  </div>

                  {liveCoaching.objectionDetected && (
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 border border-red-200 dark:border-red-800">
                      <p className="text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-1 mb-1">
                        <AlertTriangle className="h-3 w-3" />Objection Detected: {liveCoaching.objectionDetected}
                      </p>
                      <p className="text-sm text-red-700 dark:text-red-300">{liveCoaching.objectionHandler}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Say this:</p>
                    {liveCoaching.suggestions.map((s, i) => (
                      <div key={i} className={`rounded-lg p-3 border-l-4 ${
                        s.priority === "high" ? "border-l-red-500 bg-red-50/50 dark:bg-red-900/10" :
                        s.priority === "medium" ? "border-l-amber-500 bg-amber-50/50 dark:bg-amber-900/10" :
                        "border-l-blue-500 bg-blue-50/50 dark:bg-blue-900/10"
                      }`}>
                        <p className="text-sm font-medium">"{s.text}"</p>
                        <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge className={getStageColor(liveCoaching.stageDetected)}>{liveCoaching.stageDetected}</Badge>
                    <p className="text-xs text-muted-foreground">{liveCoaching.toneAdvice}</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Sparkles className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">Coaching suggestions will appear as the conversation progresses.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Objection Reference */}
          <Card>
            <CardContent className="py-4">
              <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4 text-indigo-500" />Quick Handlers
              </h3>
              <div className="space-y-2 text-xs">
                <div className="bg-muted/50 rounded p-2">
                  <p className="font-medium">"Too expensive"</p>
                  <p className="text-muted-foreground">→ "What's it costing you NOT to solve this?"</p>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <p className="font-medium">"I need to think about it"</p>
                  <p className="text-muted-foreground">→ "100% — what specifically are you weighing up?"</p>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <p className="font-medium">"We already have something"</p>
                  <p className="text-muted-foreground">→ "How's that working for you? Getting the results you want?"</p>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <p className="font-medium">"Send me an email"</p>
                  <p className="text-muted-foreground">→ "Happy to! What specific info would be most useful?"</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ========================
  // IDLE STATE - Scenario Browse
  // ========================
  if (callState === "idle") {
    const scenarioGroups: Record<string, any[]> = {};
    pastSessions.forEach((s: any) => {
      const key = s.scenario_name || s.scenario_id;
      if (!scenarioGroups[key]) scenarioGroups[key] = [];
      scenarioGroups[key].push(s);
    });

    return (
      <div className="px-4 py-6 md:py-8 max-w-5xl mx-auto overflow-x-hidden">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-xl md:text-3xl font-bold flex items-center gap-2 md:gap-3">
              Practice <Gamepad2 className="h-6 w-6 md:h-8 md:w-8 text-primary" />
            </h1>
            <div className="flex items-center gap-1 bg-muted rounded-full p-1 overflow-x-auto">
              <button onClick={() => setTopTab("practice")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${topTab === "practice" ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                <Gamepad2 className="h-3.5 w-3.5" />Practice
              </button>
              <button onClick={() => setTopTab("live_calls")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${topTab === "live_calls" ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                <Radio className="h-3.5 w-3.5" />Live Calls
              </button>
              <button onClick={() => setTopTab("results")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${topTab === "results" ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                <History className="h-3.5 w-3.5" />Results
              </button>
              <button onClick={() => setTopTab("progress")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${topTab === "progress" ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                <ChartLine className="h-3.5 w-3.5" />Progress
              </button>
            </div>
          </div>
          <p className="text-muted-foreground text-sm">
            {topTab === "practice" ? "Sharpen your skills through live AI role plays that drop you into realistic scenarios." :
             topTab === "live_calls" ? "Get real-time AI coaching during actual sales calls with smart objection handling." :
             topTab === "results" ? "Review your past practice sessions and track your improvement." :
             "See your improvement over time across different scenarios."}
          </p>
        </div>

        {/* LIVE CALLS TAB */}
        {topTab === "live_calls" && (
          <div className="space-y-6">
            <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
              <CardContent className="py-8 text-center space-y-4">
                <div className="h-20 w-20 rounded-full bg-primary/10 mx-auto flex items-center justify-center">
                  <Headphones className="h-10 w-10 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Real-Time Call Assistance</h2>
                  <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                    Get live AI coaching during actual sales calls. Real-time transcription, smart suggestions, and objection handling help.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-3">
                  <Badge variant="outline" className="text-xs">🎙️ Live Transcription</Badge>
                  <Badge variant="outline" className="text-xs">🧠 Smart Suggestions</Badge>
                  <Badge variant="outline" className="text-xs">🛡️ Objection Handlers</Badge>
                  <Badge variant="outline" className="text-xs">📊 Stage Detection</Badge>
                </div>
                <Button size="lg" className="mt-4" onClick={startLiveAssist}>
                  <Radio className="h-5 w-5 mr-2" />Start Live Assistance
                </Button>
                <p className="text-xs text-muted-foreground">
                  Start this before or during your sales call. Your mic will listen and provide coaching in real-time.
                </p>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="py-4 text-center">
                  <Mic className="h-8 w-8 text-primary mx-auto mb-2" />
                  <h4 className="font-bold text-sm">1. Start Listening</h4>
                  <p className="text-xs text-muted-foreground mt-1">Click "Start Live Assistance" and grant mic access</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 text-center">
                  <PhoneCall className="h-8 w-8 text-primary mx-auto mb-2" />
                  <h4 className="font-bold text-sm">2. Make Your Call</h4>
                  <p className="text-xs text-muted-foreground mt-1">Call your prospect on speaker or with earbuds</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 text-center">
                  <Brain className="h-8 w-8 text-primary mx-auto mb-2" />
                  <h4 className="font-bold text-sm">3. Get Coached</h4>
                  <p className="text-xs text-muted-foreground mt-1">AI analyzes conversation and suggests responses</p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* PAST RESULTS TAB */}
        {topTab === "results" && (
          <div>
            {loadingPast ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : pastSessions.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <History className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <h4 className="font-bold">No Sessions Yet</h4>
                  <p className="text-sm text-muted-foreground mt-1">Complete a practice call to see your results here</p>
                </CardContent>
              </Card>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-3 px-2 text-sm font-semibold text-muted-foreground">Date & Time</th>
                      <th className="py-3 px-2 text-sm font-semibold text-muted-foreground">Duration</th>
                      <th className="py-3 px-2 text-sm font-semibold text-muted-foreground">Scenario</th>
                      <th className="py-3 px-2 text-sm font-semibold text-muted-foreground">Type</th>
                      <th className="py-3 px-2 text-sm font-semibold text-muted-foreground text-right">Score / 100</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastSessions.map((s: any) => {
                      const date = new Date(s.created_at);
                      const transcript = s.transcript || [];
                      const duration = transcript.length > 1
                        ? (() => {
                            const first = new Date(transcript[0]?.timestamp || s.created_at);
                            const last = new Date(transcript[transcript.length - 1]?.timestamp || s.created_at);
                            const mins = Math.round((last.getTime() - first.getTime()) / 60000);
                            return `${mins}:${String(Math.round(((last.getTime() - first.getTime()) % 60000) / 1000)).padStart(2, "0")}`;
                          })()
                        : "0:00";
                      const score = s.overall_score || 0;
                      return (
                        <tr key={s.id} className="border-b hover:bg-muted/50">
                          <td className="py-3 px-2">
                            <p className="text-sm font-medium">{date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                            <p className="text-xs text-muted-foreground">{date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>
                          </td>
                          <td className="py-3 px-2 text-sm">{duration}</td>
                          <td className="py-3 px-2">
                            <p className="text-sm font-medium">{s.scenario_name || s.scenario_id}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              {s.status === "completed" ? "Analyzed" : s.status}
                            </p>
                          </td>
                          <td className="py-3 px-2">
                            <Badge variant="outline" className="text-xs flex items-center gap-1 w-fit">
                              {s.phone_number === "browser-voice" ? <><Mic className="h-3 w-3" />Voice</> : <><Phone className="h-3 w-3" />Call</>}
                            </Badge>
                          </td>
                          <td className="py-3 px-2 text-right">
                            <span className={`text-2xl font-bold ${score >= 70 ? "text-emerald-600 dark:text-emerald-400" : score >= 40 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>{score}</span>
                            <span className={`ml-1 inline-block w-8 h-2 rounded-full ${score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500"}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* PROGRESS TAB */}
        {topTab === "progress" && (
          <div>
            <div className="flex items-center gap-2 mb-6">
              <ChartLine className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-bold text-lg">Your Progress</h3>
                <p className="text-sm text-muted-foreground">Track your improvement across different scenarios</p>
              </div>
            </div>
            {Object.keys(scenarioGroups).length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <ChartLine className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <h4 className="font-bold">No Data Yet</h4>
                  <p className="text-sm text-muted-foreground mt-1">Complete practice sessions to see your progress</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {Object.entries(scenarioGroups).map(([name, sessions]) => {
                  const sorted = [...sessions].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                  const scores = sorted.map((s: any) => s.overall_score || 0);
                  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
                  const best = Math.max(...scores);
                  const isImproving = scores.length >= 2 && scores[scores.length - 1] > scores[0];
                  const chartData = sorted.map((s: any, i: number) => ({ name: `#${i + 1}`, score: s.overall_score || 0 }));

                  return (
                    <Card key={name}>
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h4 className="font-bold text-sm">{name}</h4>
                            <p className="text-xs text-muted-foreground">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">Avg</p>
                              <p className={`font-bold ${avg >= 70 ? "text-emerald-600" : avg >= 40 ? "text-amber-600" : "text-red-600"}`}>{avg}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">Best</p>
                              <p className="font-bold text-emerald-600">{best}</p>
                            </div>
                            {isImproving && <TrendingUp className="h-4 w-4 text-emerald-500" />}
                          </div>
                        </div>
                        {chartData.length > 1 && (
                          <ResponsiveContainer width="100%" height={120}>
                            <AreaChart data={chartData}>
                              <defs>
                                <linearGradient id={`gradient-${name}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                              <Tooltip />
                              <Area type="monotone" dataKey="score" stroke="hsl(var(--primary))" fill={`url(#gradient-${name})`} strokeWidth={2} />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* PRACTICE TAB - Scenario Browser */}
        {topTab === "practice" && (
          <>
            {/* Category filters */}
            <div className="flex gap-2 overflow-x-auto mb-6 pb-1">
              {SCENARIO_CATEGORIES.map(cat => (
                <button key={cat.id} onClick={() => setActiveCategory(cat.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${activeCategory === cat.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                  <cat.icon className="h-3.5 w-3.5" />{cat.label}
                </button>
              ))}
            </div>

            {/* Scenarios grouped by difficulty */}
            {(["Easy", "Medium", "Hard"] as Difficulty[]).map(diff => {
              const scenarios = filteredScenarios.filter(s => s.difficulty === diff);
              if (scenarios.length === 0) return null;
              return (
                <div key={diff} className="mb-8">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className={difficultyColor[diff]}>{diff}</Badge>
                    <span className="text-xs text-muted-foreground">{scenarios.length} scenario{scenarios.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {scenarios.map(scenario => (
                      <Card key={scenario.id} className="cursor-pointer hover:border-primary/30 transition-all hover:shadow-md" onClick={() => openScenarioDetail(scenario)}>
                        <CardContent className="py-5">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-bold text-base">{scenario.name}</h3>
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                <Badge className={`text-xs ${difficultyColor[scenario.difficulty]}`}>{scenario.difficulty}</Badge>
                                <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{scenario.duration}</span>
                              </div>
                            </div>
                            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0 ml-3">
                              <User className="h-6 w-6 text-muted-foreground" />
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{scenario.description}</p>
                          <div className="bg-muted/50 rounded-lg p-2.5 text-xs">
                            <p className="font-medium mb-0.5">You'll be speaking with:</p>
                            <p className="flex items-center gap-1"><User className="h-3 w-3" />{scenario.prospectName} - {scenario.prospectRole}</p>
                            <p className="text-muted-foreground">🏢 {scenario.prospectCompany}</p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  }

  // ========================
  // SCENARIO DETAIL STATE
  // ========================
  if (callState === "scenario_detail" && selectedScenario) {
    return (
      <div className="px-4 py-6 md:py-8 max-w-5xl mx-auto overflow-x-hidden">
        <button onClick={backToScenarios} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" />Back to scenarios
        </button>

        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Gamepad2 className="h-6 w-6 text-primary" />
          {selectedScenario.name} Practice
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Phone mockup - NO phone number needed */}
          <div className="lg:col-span-2">
            <div className="border-[8px] border-foreground rounded-[2.5rem] p-1 max-w-[280px] mx-auto bg-background">
              <div className="rounded-[2rem] overflow-hidden">
                <div className="bg-foreground h-7 flex items-center justify-center">
                  <div className="w-20 h-4 bg-foreground rounded-b-xl" />
                </div>
                <div className="p-6 text-center space-y-4 min-h-[350px] flex flex-col items-center justify-center">
                  <div className="h-20 w-20 rounded-full bg-muted mx-auto flex items-center justify-center">
                    <User className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{selectedScenario.prospectName}</h3>
                    <p className="text-sm text-primary">{selectedScenario.prospectRole}</p>
                    <p className="text-xs text-muted-foreground">{selectedScenario.prospectCompany}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
                    Ready to Connect
                  </div>
                  <div className="pt-2 flex gap-3">
                    <Button size="lg" className="h-16 w-16 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={startVoiceCall}>
                      <Mic className="h-7 w-7" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Tap to start voice practice</p>
                </div>
                <div className="h-5 flex items-center justify-center">
                  <div className="w-28 h-1 bg-foreground/20 rounded-full" />
                </div>
              </div>
            </div>
          </div>

          {/* Info Tabs */}
          <div className="lg:col-span-3">
            <Tabs value={activeDetailTab} onValueChange={setActiveDetailTab}>
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="scene" className="text-xs">ℹ️ Scene</TabsTrigger>
                <TabsTrigger value="learn" className="text-xs">🎯 Learn</TabsTrigger>
                <TabsTrigger value="prospect" className="text-xs">👤 Prospect</TabsTrigger>
                <TabsTrigger value="business" className="text-xs">💼 Business</TabsTrigger>
              </TabsList>

              <TabsContent value="scene" className="mt-4 space-y-4">
                <div>
                  <h3 className="font-bold text-lg">{selectedScenario.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{selectedScenario.description}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5 mb-2">⚙️ Practice Objectives</h4>
                  <ul className="space-y-1">
                    {selectedScenario.objectives.map((obj, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2"><span>•</span>{obj}</li>
                    ))}
                  </ul>
                </div>
              </TabsContent>

              <TabsContent value="learn" className="mt-4 space-y-4">
                {!learnContent && !loadingLearn && (
                  <div className="text-center py-8 space-y-3">
                    <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">Generate personalized learning content from your Brain's knowledge.</p>
                    <Button onClick={() => generateLearnContent(selectedScenario)}>
                      <Sparkles className="h-4 w-4 mr-2" />Generate Learning Guide
                    </Button>
                  </div>
                )}
                {loadingLearn && (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Your Brain is generating learning material...</p>
                  </div>
                )}
                {learnContent && (
                  <>
                    <div className="bg-primary/5 rounded-lg p-4 border border-primary/10">
                      <h4 className="font-bold text-base mb-1">{learnContent.frameworkName || "Sales Framework"}</h4>
                      <p className="text-sm text-muted-foreground">{learnContent.frameworkDescription}</p>
                    </div>
                    {learnContent.keyLearningPoints?.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-sm flex items-center gap-1.5 mb-2">🎯 Key Learning Points</h4>
                        <div className="space-y-2">
                          {learnContent.keyLearningPoints.map((point: string, i: number) => (
                            <div key={i} className="text-sm text-muted-foreground flex items-start gap-2 bg-muted/50 rounded-lg p-3">
                              <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />{point}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {learnContent.examplePhrases?.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-sm mb-2">💬 Example Phrases</h4>
                        <div className="space-y-2">
                          {learnContent.examplePhrases.map((p: any, i: number) => (
                            <div key={i} className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground border-l-2 border-primary/30">
                              <span className="font-medium text-foreground">{p.label} ({p.code}): </span>"{p.phrase}"
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {learnContent.successMetrics?.length > 0 && (
                      <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4">
                        <h4 className="font-semibold text-sm flex items-center gap-1.5 mb-2">✅ Success Metrics</h4>
                        <ul className="space-y-1">
                          {learnContent.successMetrics.map((m: string, i: number) => (
                            <li key={i} className="text-sm flex items-start gap-2 text-emerald-700 dark:text-emerald-400"><span>🟢</span>{m}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {learnContent.commonMistakes?.length > 0 && (
                      <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
                        <h4 className="font-semibold text-sm flex items-center gap-1.5 mb-2">🚫 Common Mistakes</h4>
                        <ul className="space-y-1">
                          {learnContent.commonMistakes.map((m: string, i: number) => (
                            <li key={i} className="text-sm flex items-start gap-2 text-red-600 dark:text-red-400"><span>🟠</span>{m}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {learnContent.proTips?.length > 0 && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4">
                        <h4 className="font-semibold text-sm flex items-center gap-1.5 mb-2">💡 Pro Tips from Your Brain</h4>
                        <ul className="space-y-1">
                          {learnContent.proTips.map((t: string, i: number) => (
                            <li key={i} className="text-sm flex items-start gap-2"><Lightbulb className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />{t}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <Button variant="outline" size="sm" onClick={() => generateLearnContent(selectedScenario)} className="w-full">
                      <RotateCcw className="h-4 w-4 mr-2" />Regenerate
                    </Button>
                  </>
                )}
              </TabsContent>

              <TabsContent value="prospect" className="mt-4 space-y-4">
                <h3 className="font-bold">About {selectedScenario.prospectName}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Role & Company</p>
                    <p className="text-sm font-semibold">{selectedScenario.prospectRole}</p>
                    <p className="text-xs text-muted-foreground">{selectedScenario.prospectCompany}</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Personality</p>
                    <p className="text-xs italic text-muted-foreground">"{selectedScenario.prospectPersonality}"</p>
                  </div>
                </div>
                {selectedScenario.expectedObjections && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Expected Objections</h4>
                    <ul className="space-y-1">
                      {selectedScenario.expectedObjections.map((obj, i) => (
                        <li key={i} className="text-sm text-muted-foreground flex items-start gap-2"><span>•</span>"{obj}"</li>
                      ))}
                    </ul>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="business" className="mt-4 space-y-4">
                <h3 className="font-bold">Scenario Context</h3>
                {companyProfile ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">The AI prospect will use your business context for realistic practice.</p>
                    <div className="space-y-2">
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Company</p>
                        <p className="text-sm font-semibold">{companyProfile.company_name || "Not set"}</p>
                      </div>
                      {companyProfile.what_selling && (
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs font-medium text-muted-foreground mb-1">What You Sell</p>
                          <p className="text-sm">{companyProfile.what_selling}</p>
                        </div>
                      )}
                      {companyProfile.target_audience && (
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Target Audience</p>
                          <p className="text-sm">{companyProfile.target_audience}</p>
                        </div>
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => window.location.href = "/company"}>
                      Edit Company Profile
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-6 space-y-3">
                    <Info className="h-8 w-8 mx-auto text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">Set up your company profile for more realistic AI practice.</p>
                    <Button variant="outline" size="sm" onClick={() => window.location.href = "/company"}>
                      Set Up Company
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    );
  }

  // ========================
  // VOICE RINGING STATE
  // ========================
  if (callState === "voice_ringing") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-6">
        <div className="relative">
          <div className="h-24 w-24 rounded-full bg-emerald-500/20 flex items-center justify-center animate-pulse">
            <Mic className="h-10 w-10 text-emerald-500 animate-bounce" />
          </div>
          <div className="absolute -inset-4 rounded-full border-2 border-emerald-500/30 animate-ping" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold">{selectedScenario?.prospectName}</h2>
          <p className="text-sm text-muted-foreground">{selectedScenario?.prospectRole}</p>
          <p className="text-muted-foreground animate-pulse mt-2">Connecting...</p>
        </div>
        <Button variant="destructive" size="lg" onClick={() => setCallState("scenario_detail")}>
          <PhoneOff className="h-5 w-5 mr-2" />Cancel
        </Button>
      </div>
    );
  }

  // ========================
  // VOICE CONNECTED STATE
  // ========================
  if (callState === "voice_connected" && selectedScenario) {
    return (
      <div className="px-4 py-6 max-w-5xl mx-auto overflow-x-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Phone mockup - Connected */}
          <div className="lg:col-span-2">
            <div className="border-[8px] border-foreground rounded-[2.5rem] p-1 max-w-[280px] mx-auto bg-background">
              <div className="rounded-[2rem] overflow-hidden">
                <div className="bg-foreground h-7 flex items-center justify-center">
                  <div className="w-20 h-4 bg-foreground rounded-b-xl" />
                </div>
                <div className="p-6 text-center space-y-3 min-h-[350px] flex flex-col items-center justify-center">
                  <div className="h-20 w-20 rounded-full bg-emerald-500/20 mx-auto flex items-center justify-center">
                    <User className="h-10 w-10 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{selectedScenario.prospectName}</h3>
                    <p className="text-sm text-primary">{selectedScenario.prospectRole}</p>
                    <p className="text-xs text-muted-foreground">{selectedScenario.prospectCompany}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-emerald-600 font-mono">{formatDuration(callDuration)}</span>
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  {/* Status indicators */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {isListening && (
                      <span className="flex items-center gap-1 text-red-500">
                        <Mic className="h-3 w-3" />Listening...
                      </span>
                    )}
                    {isSpeaking && (
                      <span className="flex items-center gap-1 text-blue-500">
                        <Volume2 className="h-3 w-3" />Speaking...
                      </span>
                    )}
                  </div>
                  <div className="pt-4">
                    <Button size="lg" variant="destructive" className="h-16 w-16 rounded-full" onClick={endVoiceCall}>
                      <PhoneOff className="h-7 w-7" />
                    </Button>
                  </div>
                </div>
                <div className="h-5 flex items-center justify-center">
                  <div className="w-28 h-1 bg-foreground/20 rounded-full" />
                </div>
              </div>
            </div>
          </div>

          {/* Live Transcript */}
          <div className="lg:col-span-3">
            <Card>
              <CardContent className="py-4">
                <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  Live Transcript
                  <span className="flex items-center gap-1 text-xs text-red-500 ml-auto">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />Live
                  </span>
                </h3>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {voiceTranscript.length > 0 ? voiceTranscript.map((turn, i) => (
                      <div key={i} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          turn.role === "user" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md"
                        }`}>
                          <p className="text-xs font-medium mb-1">{turn.role === "user" ? "You" : selectedScenario.prospectName}</p>
                          <p className="text-sm">{turn.text}</p>
                        </div>
                      </div>
                    )) : (
                      <div className="text-center py-12">
                        <Mic className="h-10 w-10 mx-auto text-muted-foreground/50 animate-pulse mb-3" />
                        <p className="text-sm text-muted-foreground">Waiting for the prospect to speak...</p>
                      </div>
                    )}
                    <div ref={transcriptEndRef} />
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground mt-3 text-center">
              Speak naturally — the AI prospect will respond. Tap the red button when done.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ========================
  // VOICE ENDED STATE (Post-call analysis)
  // ========================
  if (callState === "voice_ended") {
    const a = phoneAnalysis;
    const sectionIcons: Record<string, React.ReactNode> = {
      handshake: <Handshake className="h-5 w-5 text-amber-500" />,
      search: <Search className="h-5 w-5 text-purple-500" />,
      diamond: <Diamond className="h-5 w-5 text-blue-500" />,
      shield: <Shield className="h-5 w-5 text-indigo-500" />,
      target: <Target className="h-5 w-5 text-red-500" />,
    };

    const getScoreBadgeColor = (score: number) => {
      if (score >= 70) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
      if (score >= 40) return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    };

    const getAnalyticStatus = (value: number, min: number, max: number) => value >= min && value <= max;

    return (
      <div className="px-4 py-6 md:py-8 max-w-4xl mx-auto overflow-x-hidden">
        <button onClick={() => { setPhoneAnalysis(null); resetCall(); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" />Back to scenarios
        </button>

        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          🎯 {selectedScenario?.name} — Results
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
          {/* Phone mockup */}
          <div className="lg:col-span-2">
            <div className="border-[8px] border-foreground rounded-[2.5rem] p-1 max-w-[280px] mx-auto bg-background">
              <div className="rounded-[2rem] overflow-hidden">
                <div className="bg-foreground h-7 flex items-center justify-center">
                  <div className="w-20 h-4 bg-foreground rounded-b-xl" />
                </div>
                <div className="p-6 text-center space-y-4 min-h-[300px] flex flex-col items-center justify-center">
                  <div className="h-20 w-20 rounded-full bg-muted mx-auto flex items-center justify-center">
                    <User className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{selectedScenario?.prospectName}</h3>
                    <p className="text-sm text-primary">{selectedScenario?.prospectRole}</p>
                    <p className="text-xs text-muted-foreground">{selectedScenario?.prospectCompany}</p>
                  </div>
                  {isAnalyzing ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-8 w-8 text-primary animate-spin" />
                      <p className="text-sm text-muted-foreground">Analyzing...</p>
                    </div>
                  ) : (
                    <>
                      <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                      <p className="font-semibold">Complete!</p>
                      <p className="text-xs text-muted-foreground">{formatDuration(callDuration)}</p>
                      <Button variant="outline" size="sm" onClick={() => {
                        setVoiceTranscript([]);
                        setVoiceSessionId(null);
                        setPhoneAnalysis(null);
                        setCallDuration(0);
                        startVoiceCall();
                      }}>Try Again</Button>
                    </>
                  )}
                </div>
                <div className="h-5 flex items-center justify-center">
                  <div className="w-28 h-1 bg-foreground/20 rounded-full" />
                </div>
              </div>
            </div>
          </div>

          {/* Results content */}
          <div className="lg:col-span-3">
            {isAnalyzing ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 py-12">
                <Loader2 className="h-10 w-10 text-primary animate-spin" />
                <div className="text-center">
                  <h2 className="text-xl font-bold mb-1">Analyzing Your Call</h2>
                  <p className="text-sm text-muted-foreground">Our AI coach is reviewing your transcript...</p>
                </div>
              </div>
            ) : a ? (
              <Tabs defaultValue="results" className="w-full">
                <TabsList className="w-full justify-start overflow-x-auto">
                  <TabsTrigger value="results" className="text-xs">📊 Results</TabsTrigger>
                  <TabsTrigger value="transcript" className="text-xs">💬 Transcript</TabsTrigger>
                </TabsList>

                <TabsContent value="results" className="mt-4 space-y-6">
                  {/* Overall Score */}
                  <Card className="border-primary/20">
                    <CardContent className="py-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">💪</span>
                          <div>
                            <h3 className="font-bold text-lg">{a.scoreLabel}</h3>
                            <p className="text-sm text-muted-foreground">{a.scoreMessage}</p>
                          </div>
                        </div>
                        <div className={`text-3xl font-bold rounded-xl px-4 py-2 ${getScoreBadgeColor(a.overallScore)}`}>
                          {a.overallScore}<span className="text-sm font-normal">/100</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Breakdown */}
                  <div>
                    <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-primary" />Breakdown
                    </h3>
                    <div className="space-y-3">
                      {a.sections.map((section, i) => (
                        <Card key={i}>
                          <CardContent className="py-4">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                {sectionIcons[section.icon] || <Star className="h-5 w-5 text-primary" />}
                                <h4 className="font-bold text-sm">{section.name}</h4>
                              </div>
                              <span className={`text-sm font-bold px-2 py-0.5 rounded ${getScoreBadgeColor(section.score)}`}>{section.score}/100</span>
                            </div>
                            <p className="text-sm text-muted-foreground">{section.feedback}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>

                  {/* Highlight Reel */}
                  {a.highlightReel && (
                    <Card>
                      <CardContent className="py-5">
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Zap className="h-5 w-5 text-primary" />Highlight Reel</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="rounded-xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 p-4">
                            <span className="flex items-center gap-1 text-sm font-bold text-emerald-600 dark:text-emerald-400 mb-2">⭐ Best Moment</span>
                            <p className="text-sm font-medium mb-2 italic">"{a.highlightReel.bestMoment.quote}"</p>
                            <p className="text-xs text-muted-foreground">{a.highlightReel.bestMoment.explanation}</p>
                          </div>
                          <div className="rounded-xl border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-4">
                            <span className="flex items-center gap-1 text-sm font-bold text-amber-600 dark:text-amber-400 mb-2">🔶 Needs Work</span>
                            <p className="text-sm font-medium mb-2 italic">"{a.highlightReel.needsWork.quote}"</p>
                            <p className="text-xs text-muted-foreground">{a.highlightReel.needsWork.explanation}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Key Takeaways */}
                  {a.keyTakeaways && (
                    <Card>
                      <CardContent className="py-5">
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Sparkles className="h-5 w-5 text-amber-500" />Key Takeaways</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="rounded-xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 p-4">
                            <h4 className="font-bold text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mb-3"><CheckCircle2 className="h-4 w-4" /> What You Did Well</h4>
                            <div className="space-y-2">
                              {a.keyTakeaways.didWell.map((item, i) => (
                                <p key={i} className="text-sm flex items-start gap-2"><span className="text-emerald-500 mt-0.5">✓</span>{item}</p>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-xl border border-border p-4">
                            <h4 className="font-bold text-sm flex items-center gap-1 mb-3"><Lightbulb className="h-4 w-4 text-amber-500" /> Focus Areas</h4>
                            <div className="space-y-2">
                              {a.keyTakeaways.focusAreas.map((item, i) => (
                                <p key={i} className="text-sm flex items-start gap-2"><span className="text-amber-500 font-bold mt-0.5">{i + 1}</span><span className="text-muted-foreground">{item}</span></p>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Objection Replay */}
                  {a.objectionReplay && a.objectionReplay.length > 0 && (
                    <Card>
                      <CardContent className="py-5">
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Shield className="h-5 w-5 text-indigo-500" />Objection Replay</h3>
                        <div className="space-y-3">
                          {a.objectionReplay.map((obj, i) => (
                            <div key={i} className={`rounded-xl p-4 border-l-4 ${obj.handled ? "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10" : "border-l-red-400 bg-red-50/50 dark:bg-red-900/10"}`}>
                              <div className="flex items-start gap-2 mb-1">
                                {obj.handled ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />}
                                <p className="text-sm font-medium">"{obj.objection}"</p>
                              </div>
                              <p className="text-xs text-muted-foreground ml-6">Your response: "{obj.response}"</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Call Analytics */}
                  {a.callAnalytics && (
                    <Card>
                      <CardContent className="py-5">
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" />Call Analytics</h3>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div className="rounded-xl border p-4">
                            <p className="text-sm text-muted-foreground">Talk/Listen</p>
                            <p className="text-2xl font-bold">{a.callAnalytics.talkListenRatio}%</p>
                            <p className={`text-xs ${getAnalyticStatus(a.callAnalytics.talkListenRatio, 40, 60) ? "text-emerald-600" : "text-red-500"}`}>Ideal: 40-60%</p>
                          </div>
                          <div className="rounded-xl border p-4">
                            <p className="text-sm text-muted-foreground">Speed</p>
                            <p className="text-2xl font-bold">{a.callAnalytics.talkSpeed} <span className="text-sm font-normal">wpm</span></p>
                            <p className={`text-xs ${getAnalyticStatus(a.callAnalytics.talkSpeed, 110, 160) ? "text-emerald-600" : "text-red-500"}`}>Ideal: 110-160</p>
                          </div>
                          <div className="rounded-xl border p-4">
                            <p className="text-sm text-muted-foreground">Longest Talk</p>
                            <p className="text-2xl font-bold">{a.callAnalytics.longestMonologue}</p>
                          </div>
                          <div className="rounded-xl border p-4">
                            <p className="text-sm text-muted-foreground">Objections</p>
                            <p className="text-2xl font-bold">{a.callAnalytics.objectionsHandled}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-xl bg-muted/50 p-3 text-center">
                            <p className="text-xl font-bold">{a.callAnalytics.userWordCount}</p>
                            <p className="text-xs text-muted-foreground">Your Words</p>
                          </div>
                          <div className="rounded-xl bg-muted/50 p-3 text-center">
                            <p className="text-xl font-bold">{a.callAnalytics.prospectWordCount}</p>
                            <p className="text-xs text-muted-foreground">Prospect Words</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="transcript" className="mt-4">
                  <Card>
                    <CardContent className="py-4">
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-primary" />Full Transcript
                      </h3>
                      <div className="space-y-3">
                        {voiceTranscript.map((turn, i) => (
                          <div key={i} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${turn.role === "user" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md"}`}>
                              <p className="text-xs font-medium mb-1">{turn.role === "user" ? "You" : selectedScenario?.prospectName}</p>
                              <p className="text-sm">{turn.text}</p>
                            </div>
                          </div>
                        ))}
                        {voiceTranscript.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-4">No transcript recorded.</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            ) : (
              <Card>
                <CardContent className="py-4">
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />Call Transcript
                  </h3>
                  <div className="space-y-3">
                    {voiceTranscript.map((turn, i) => (
                      <div key={i} className={`text-sm ${turn.role === "user" ? "text-primary font-medium" : "text-muted-foreground"}`}>
                        <span className="text-xs font-bold mr-1">{turn.role === "user" ? "You:" : `${selectedScenario?.prospectName}:`}</span>
                        {turn.text}
                      </div>
                    ))}
                  </div>
                  {voiceTranscript.length > 0 && (
                    <Button className="mt-4 w-full" onClick={() => voiceSessionId && analyzeVoiceCall(voiceTranscript, voiceSessionId)}>
                      <Sparkles className="h-4 w-4 mr-2" />Analyze My Call
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <Button size="lg" className="bg-primary" onClick={() => {
            setVoiceTranscript([]);
            setVoiceSessionId(null);
            setPhoneAnalysis(null);
            setCallDuration(0);
            startVoiceCall();
          }}>
            <Mic className="h-4 w-4 mr-2" />Practice Again
          </Button>
          <Button variant="outline" size="lg" onClick={() => { setPhoneAnalysis(null); resetCall(); }}>
            <Gamepad2 className="h-4 w-4 mr-2" />Choose New Scenario
          </Button>
        </div>
      </div>
    );
  }

  // ========================
  // TEXT PRACTICE - RINGING STATE
  // ========================
  if (callState === "ringing") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-6">
        <div className="relative">
          <div className="h-24 w-24 rounded-full bg-emerald-500/20 flex items-center justify-center animate-pulse">
            <Phone className="h-10 w-10 text-emerald-500 animate-bounce" />
          </div>
          <div className="absolute -inset-4 rounded-full border-2 border-emerald-500/30 animate-ping" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold">{selectedScenario?.prospectName}</h2>
          <p className="text-sm text-muted-foreground">{selectedScenario?.prospectRole}</p>
          <p className="text-muted-foreground animate-pulse mt-2">Calling...</p>
        </div>
        <Button variant="destructive" size="lg" onClick={() => setCallState("scenario_detail")}>
          <PhoneOff className="h-5 w-5 mr-2" />Cancel
        </Button>
      </div>
    );
  }

  // ========================
  // TEXT PRACTICE - CONNECTED or ENDED STATE
  // ========================
  const lastCoaching = [...messages].reverse().find(m => m.coaching)?.coaching;

  if (callState === "ended") {
    const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0;
    const bestScore = Math.max(...allScores, 0);
    const uniqueTechniques = [...new Set(allTechniques)];
    const uniqueStages = [...new Set(allStages)];
    const userMsgCount = messages.filter(m => m.role === "user").length;

    return (
      <div className="px-4 py-6 md:py-8 max-w-3xl mx-auto overflow-x-hidden">
        <div className="text-center mb-6 sm:mb-8">
          <Trophy className={`h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 ${getScoreColor(avgScore)}`} />
          <h1 className="text-2xl sm:text-3xl font-bold mb-1">Practice Complete</h1>
          <p className="text-sm text-muted-foreground">{selectedScenario?.name}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6 sm:mb-8">
          <Card><CardContent className="p-3 sm:py-4 text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">Overall Score</p>
            <p className={`text-xl sm:text-3xl font-bold ${getScoreColor(avgScore)}`}>{avgScore}/10</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 sm:py-4 text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">Messages</p>
            <p className="text-xl sm:text-3xl font-bold">{userMsgCount}</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 sm:py-4 text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">Best Turn</p>
            <p className={`text-xl sm:text-3xl font-bold ${getScoreColor(bestScore)}`}>{bestScore}/10</p>
          </CardContent></Card>
        </div>

        {allScores.length > 1 && (
          <Card className="mb-6">
            <CardContent className="py-4">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />Score Progression</h3>
              <div className="flex items-end gap-1 h-20">
                {allScores.map((s, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">{s}</span>
                    <div className={`w-full rounded-t ${s >= 8 ? "bg-emerald-500" : s >= 5 ? "bg-amber-500" : "bg-red-500"}`} style={{ height: `${(s / 10) * 100}%` }} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-3 sm:gap-4 mb-4 sm:mb-6">
          {uniqueTechniques.length > 0 && (
            <Card><CardContent className="py-4">
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Techniques Used</h3>
              <div className="flex flex-wrap gap-1.5">
                {uniqueTechniques.map((t, i) => <Badge key={i} variant="outline" className="text-xs">{t}</Badge>)}
              </div>
            </CardContent></Card>
          )}
          <Card><CardContent className="py-4">
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" />Stages Reached</h3>
            <div className="flex flex-wrap gap-1.5">
              {uniqueStages.map((s, i) => <Badge key={i} className={`text-xs ${getStageColor(s)}`}>{s}</Badge>)}
            </div>
          </CardContent></Card>
        </div>

        <Card className="mb-6">
          <CardContent className="py-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Coach Summary</h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {allFeedback.filter(Boolean).map((fb, i) => (
                <p key={i} className="text-xs text-muted-foreground border-l-2 border-primary/20 pl-2">{fb}</p>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center">
          <Button variant="outline" size="sm" onClick={resetCall}><RotateCcw className="h-4 w-4 mr-1" />Try Another</Button>
          <Button size="sm" onClick={() => { setCallState("ringing"); setMessages([]); setAllScores([]); setAllFeedback([]); setAllTechniques([]); setAllStages([]); startCall(); }}>
            <Phone className="h-4 w-4 mr-1" />Retry Scenario
          </Button>
        </div>
      </div>
    );
  }

  // ========================
  // TEXT PRACTICE - CONNECTED STATE (Chat)
  // ========================
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="border-b px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between bg-background/95 backdrop-blur shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <div className="min-w-0">
            <h2 className="font-semibold text-xs sm:text-sm truncate">{selectedScenario?.prospectName} — {selectedScenario?.name}</h2>
            <div className="flex items-center gap-2">
              {lastCoaching && <Badge className={`text-[10px] ${getStageColor(lastCoaching.conversationStage)}`}>{lastCoaching.conversationStage}</Badge>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {overallScore > 0 && (
            <div className="flex items-center gap-1">
              <Star className={`h-4 w-4 ${getScoreColor(overallScore)}`} />
              <span className={`text-sm font-bold ${getScoreColor(overallScore)}`}>{overallScore}/10</span>
            </div>
          )}
          <Button variant="destructive" size="sm" onClick={endCall}>
            <PhoneOff className="h-4 w-4 mr-1" />End
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4 max-w-2xl mx-auto pb-4">
            {messages.map((msg, i) => (
              <div key={i}>
                <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md"}`}>
                    <p className="text-sm">{msg.content}</p>
                  </div>
                </div>
                {msg.coaching && (
                  <div className="mt-2 ml-2 p-3 rounded-lg bg-primary/5 border border-primary/10 max-w-[85%]">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="h-3 w-3 text-primary" />
                      <span className="text-xs font-medium text-primary">Coach</span>
                      {msg.coaching.score > 0 && <span className={`text-xs font-bold ${getScoreColor(msg.coaching.score)}`}>{msg.coaching.score}/10</span>}
                      {msg.coaching.techniqueUsed !== "none" && msg.coaching.techniqueUsed !== "none detected" && (
                        <Badge variant="outline" className="text-[10px]">{msg.coaching.techniqueUsed}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{msg.coaching.coachFeedback}</p>
                    {msg.coaching.tips?.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {msg.coaching.tips.map((tip, j) => (
                          <p key={j} className="text-xs text-muted-foreground flex items-start gap-1">
                            <Lightbulb className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />{tip}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      </div>

      <div className="border-t p-3 sm:p-4 bg-background/95 backdrop-blur shrink-0">
        <div className="flex gap-2 max-w-2xl mx-auto">
          <Input
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type your response..."
            disabled={isLoading}
            className="text-sm"
          />
          <Button onClick={sendMessage} disabled={!inputText.trim() || isLoading} size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
