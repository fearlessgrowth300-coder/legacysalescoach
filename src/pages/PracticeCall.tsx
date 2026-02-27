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
  Shield, Diamond, Info, Zap, BookOpen, History, ChartLine
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";

// Rich scenario data with categories, difficulty, personas
const SCENARIO_CATEGORIES = [
  { id: "all", label: "All Scenarios", icon: Gamepad2 },
  { id: "opening", label: "Opening", icon: Phone },
  { id: "discovery", label: "Discovery", icon: Search },
  { id: "closing", label: "Closing", icon: Handshake },
  { id: "challenge", label: "Challenge", icon: Award },
];

type Difficulty = "Easy" | "Medium" | "Hard";

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
  objectives: string[];
  examplePhrases?: string[];
  successMetrics?: string[];
  commonMistakes?: string[];
  expectedObjections?: string[];
};

const RICH_SCENARIOS: RichScenario[] = [
  // OPENING
  {
    id: "cold_call_easy",
    name: "Cold Call - Easy Mode",
    category: "opening",
    difficulty: "Easy",
    duration: "3 min",
    description: "Practice cold calling with Jenna, an ops manager who got burned by a vendor 6 months ago.",
    prospectName: "Jenna",
    prospectRole: "Operations Manager",
    prospectCompany: "Apex Solutions",
    prospectPersonality: "Cautious but open-minded. Had a bad vendor experience recently.",
    objectives: ["Build initial rapport", "Identify a pain point quickly", "Get permission to continue"],
    expectedObjections: ["We already have a solution", "I got burned last time", "Send me an email instead"],
  },
  {
    id: "cold_call_b2b",
    name: "Cold Call (B2B)",
    category: "opening",
    difficulty: "Hard",
    duration: "5 min",
    description: "Advanced cold calling with Tom, a procurement drill sergeant who gives you 30 seconds.",
    prospectName: "Tom",
    prospectRole: "Procurement Manager",
    prospectCompany: "Sterling Industries",
    prospectPersonality: "Aggressive, time-conscious, alpha-type. Will cut you off fast.",
    objectives: ["Hook within 10 seconds", "Earn the right to continue", "Schedule a follow-up"],
    expectedObjections: ["I don't take cold calls", "You have 30 seconds", "We're locked into a contract"],
  },
  {
    id: "cold_dm_approach",
    name: "Cold DM Approach",
    category: "opening",
    difficulty: "Easy",
    duration: "3 min",
    description: "You found a prospect on Instagram. Start a conversation naturally without being salesy.",
    prospectName: "Sarah",
    prospectRole: "Online Store Owner",
    prospectCompany: "Self-employed",
    prospectPersonality: "Gets DMs from salespeople daily. Only engages if it feels genuine.",
    objectives: ["Start naturally", "Show genuine interest", "Transition to business without being pushy"],
  },
  {
    id: "network_marketing_invite",
    name: "Network Marketing Invite",
    category: "opening",
    difficulty: "Medium",
    duration: "4 min",
    description: "Invite a warm contact to look at your business opportunity without triggering 'pyramid scheme' alarm.",
    prospectName: "Mike",
    prospectRole: "Office Worker",
    prospectCompany: "Corporate job, 9-5",
    prospectPersonality: "Friend/acquaintance. Slightly negative about MLM. Will ask 'is this a pyramid scheme?'",
    objectives: ["Approach with genuine care", "Pique curiosity without overselling", "Get them to look at a presentation"],
    commonMistakes: ["Pitching too hard too fast", "Getting defensive about 'pyramid scheme'", "Overselling the income"],
  },
  // DISCOVERY
  {
    id: "consultative_selling",
    name: "Consultative Selling",
    category: "discovery",
    difficulty: "Medium",
    duration: "5 min",
    description: "Guide Kwame to discover his own problems — he knows something's wrong but can't articulate it.",
    prospectName: "Kwame",
    prospectRole: "Operations Lead",
    prospectCompany: "Harmon & Associates",
    prospectPersonality: "Thoughtful, needs time to process. Knows there's a problem but can't name it.",
    objectives: ["Use open-ended questions", "Help them articulate their pain", "Don't pitch until they self-discover"],
    examplePhrases: [
      "Walk me through your typical day when [problem area] comes up...",
      "What happens when that doesn't get handled?",
      "How long has that been going on?",
    ],
  },
  {
    id: "focus_on_prospect",
    name: "Focus on Prospect",
    category: "discovery",
    difficulty: "Medium",
    duration: "4 min",
    description: "Practice active listening with Clara who rapid-fires pains. Mirror and reflect without pitching early.",
    prospectName: "Clara",
    prospectRole: "VP of Sales",
    prospectCompany: "Velocity Partners",
    prospectPersonality: "Fast talker, shares lots of problems at once. Tests if you listen or just pitch.",
    objectives: ["Mirror their language", "Prioritize their pains", "Resist the urge to pitch"],
  },
  {
    id: "follow_up_call",
    name: "Follow Up Call",
    category: "discovery",
    difficulty: "Medium",
    duration: "4 min",
    description: "Follow up with someone who said 'let me think about it' last week. Re-engage without being pushy.",
    prospectName: "Rachel",
    prospectRole: "Marketing Director",
    prospectCompany: "BrightWave Digital",
    prospectPersonality: "Said she'd think about it but forgot. Not hostile but needs re-engagement.",
    objectives: ["Re-establish rapport", "Discover what held them back", "Create new urgency"],
  },
  {
    id: "referral_ask",
    name: "Ask for Referrals",
    category: "discovery",
    difficulty: "Easy",
    duration: "3 min",
    description: "Your happy customer just got great results. Ask them for referrals naturally.",
    prospectName: "David",
    prospectRole: "Happy Customer",
    prospectCompany: "Your existing client",
    prospectPersonality: "Loves your product but never thought about referring. Needs guidance.",
    objectives: ["Anchor to their success", "Make referring easy", "Get specific names"],
  },
  // CLOSING
  {
    id: "objection_price",
    name: "Handle Price Objection",
    category: "closing",
    difficulty: "Hard",
    duration: "5 min",
    description: "The prospect loves your product but says it's too expensive. Reframe value without discounting.",
    prospectName: "Derek",
    prospectRole: "Head of Sales Enablement",
    prospectCompany: "Catalyst Media Group",
    prospectPersonality: "Genuinely likes it but gut reaction is 'too expensive'. Push back 2-3 times.",
    objectives: ["Reframe cost as investment", "Quantify the ROI", "Create urgency to act now"],
    examplePhrases: [
      "I hear you on the price. Let me ask — what's it costing you right now to NOT solve this?",
      "If this saves you [X hours/dollars] per month, when does it pay for itself?",
    ],
  },
  {
    id: "renewal_save",
    name: "Renewal Save",
    category: "closing",
    difficulty: "Hard",
    duration: "5 min",
    description: "Save an at-risk renewal with Derek, a frustrated customer whose team hasn't fully adopted your product.",
    prospectName: "Derek",
    prospectRole: "Head of Sales Enablement",
    prospectCompany: "Catalyst Media Group",
    prospectPersonality: "Frustrated, feels let down. Considering churning.",
    objectives: ["Acknowledge frustration", "Identify adoption blockers", "Propose a success plan"],
  },
  {
    id: "saas_pricing",
    name: "SaaS Pricing & Procurement",
    category: "closing",
    difficulty: "Hard",
    duration: "5 min",
    description: "Post-demo, pre-close. Linda from procurement says your pricing is 'higher than expected' and brings up competitors.",
    prospectName: "Linda",
    prospectRole: "Head of Procurement",
    prospectCompany: "Quantum Dynamics",
    prospectPersonality: "Professional, analytical. Uses competitor pricing as leverage.",
    objectives: ["Defend value without discounting", "Differentiate from competitors", "Move toward contract"],
  },
  {
    id: "enterprise_multi_stakeholder",
    name: "Enterprise Multi-Stakeholder",
    category: "closing",
    difficulty: "Hard",
    duration: "6 min",
    description: "Buying committee alignment call. Chris has the CFO worried about ROI and IT worried about security.",
    prospectName: "Chris",
    prospectRole: "VP of Operations (Your Champion)",
    prospectCompany: "Horizon Financial",
    prospectPersonality: "On your side but can't push it through alone. Needs help aligning stakeholders.",
    objectives: ["Address CFO's ROI concerns", "Handle IT's security objections", "Align all stakeholders"],
  },
  // CHALLENGE
  {
    id: "sell_pen",
    name: "Sell To The Wolf",
    category: "challenge",
    difficulty: "Hard",
    duration: "2 min",
    description: "The classic 'sell me this pen' challenge with Jordan, an aggressive stock broker. Discover his hidden frustration with expensive pens to win him over.",
    prospectName: "Jordan",
    prospectRole: "Stock Broker",
    prospectCompany: "Wall Street Securities",
    prospectPersonality: "Aggressive, money-focused, impatient, alpha-type Wall Street personality.",
    objectives: ["Identify buying signals", "Create urgency appropriately", "Close with confidence"],
    examplePhrases: [
      'Problem: "What happens when you\'re in that 5pm meeting and need to jot down that critical action item?"',
      'Solution: "You need reliable capture in any situation"',
      'Trial close: "If this prevents the 5pm scramble, worth trying?"',
    ],
    successMetrics: ["Emotion acknowledged by prospect", 'Vivid "moment of use" painted', "Need-payoff verbalized by prospect"],
    commonMistakes: ["Starting with specs/features", "No emotional stakes established", "Long explanations instead of quick hooks"],
    expectedObjections: ["I have a dozen Mont Blanc pens already", "Last pen I bought cost me $800 — I lost it in a week", "I go through pens like water during high-stress trades"],
  },
  {
    id: "product_demo",
    name: "Product Demo Pitch",
    category: "challenge",
    difficulty: "Medium",
    duration: "5 min",
    description: "Demo your product to a skeptical decision-maker who's seen 10 demos this week. Stand out.",
    prospectName: "Alex",
    prospectRole: "CTO",
    prospectCompany: "NovaTech Solutions",
    prospectPersonality: "Tech-savvy, demo-fatigued, wants to see something different. Will zone out if you just click through features.",
    objectives: ["Lead with their specific problem", "Show, don't tell", "Get a verbal commitment"],
  },
  {
    id: "team_building",
    name: "Team Building Pitch",
    category: "challenge",
    difficulty: "Medium",
    duration: "5 min",
    description: "Recruit a potential team member to join your business. They're talented but risk-averse.",
    prospectName: "Lisa",
    prospectRole: "Senior Sales Rep",
    prospectCompany: "Currently employed, stable job",
    prospectPersonality: "Great at sales, curious about entrepreneurship, but fears instability. Needs vision + proof.",
    objectives: ["Paint the vision", "Address fear of instability", "Show a realistic path to success"],
    commonMistakes: ["Overselling income potential", "Dismissing their concerns", "Making it sound too easy"],
  },
];

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

type CallState = "idle" | "scenario_detail" | "ringing" | "connected" | "ended" | "phone_ringing" | "phone_connected" | "phone_ended";

const difficultyColor: Record<Difficulty, string> = {
  Easy: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Hard: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

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
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneSessionId, setPhoneSessionId] = useState<string | null>(null);
  const [phoneCallStatus, setPhoneCallStatus] = useState("");
  const [phoneTranscript, setPhoneTranscript] = useState<Array<{ role: string; text: string; timestamp: string }>>([]);
  const [phonePolling, setPhonePolling] = useState(false);
  const [phoneAnalysis, setPhoneAnalysis] = useState<PhoneAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [topTab, setTopTab] = useState<"practice" | "results" | "progress">("practice");
  const [pastSessions, setPastSessions] = useState<any[]>([]);
  const [loadingPast, setLoadingPast] = useState(false);
  const [learnContent, setLearnContent] = useState<any>(null);
  const [loadingLearn, setLoadingLearn] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load saved phone number from profile
  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("phone_number").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => { if (data?.phone_number) setPhoneNumber(data.phone_number); });
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

  // Analyze phone call transcript
  const analyzePhoneCall = useCallback(async (transcript: Array<{ role: string; text: string; timestamp: string }>) => {
    if (transcript.length === 0 || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-phone-call", {
        body: {
          sessionId: phoneSessionId,
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
  }, [phoneSessionId, selectedScenario, isAnalyzing]);

  // Poll for phone call status
  useEffect(() => {
    if (!phoneSessionId || !phonePolling) return;
    pollIntervalRef.current = setInterval(async () => {
      try {
        const { data } = await supabase.functions.invoke("twilio-practice-call", {
          body: { action: "status", sessionId: phoneSessionId },
        });
        if (data) {
          setPhoneCallStatus(data.status);
          if (data.transcript) setPhoneTranscript(data.transcript);
          if (data.status === "completed" || data.status === "failed") {
            setPhonePolling(false);
            setCallState("phone_ended");
            // Trigger analysis
            if (data.transcript && data.transcript.length > 0) {
              analyzePhoneCall(data.transcript);
            }
          } else if (data.status === "in-progress") {
            setCallState("phone_connected");
          }
        }
      } catch {}
    }, 3000);
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, [phoneSessionId, phonePolling, analyzePhoneCall]);

  const filteredScenarios = activeCategory === "all"
    ? RICH_SCENARIOS
    : RICH_SCENARIOS.filter(s => s.category === activeCategory);

  const openScenarioDetail = (scenario: RichScenario) => {
    setSelectedScenario(scenario);
    setCallState("scenario_detail");
    setActiveDetailTab("scene");
    setLearnContent(null);
  };

  const startPhoneCall = async () => {
    if (!selectedScenario || !phoneNumber.trim()) {
      toast.error("Please enter your phone number first");
      return;
    }
    setCallState("phone_ringing");
    setPhoneTranscript([]);
    setPhoneSessionId(null);
    setPhoneCallStatus("initiating");

    try {
      const { data, error } = await supabase.functions.invoke("twilio-practice-call", {
        body: {
          action: "initiate",
          phoneNumber: phoneNumber.trim(),
          scenarioId: selectedScenario.id,
          scenarioName: selectedScenario.name,
          businessContext: businessContext || undefined,
          customScenario: {
            name: selectedScenario.name,
            description: selectedScenario.description,
            persona: `You are ${selectedScenario.prospectName}, ${selectedScenario.prospectRole} at ${selectedScenario.prospectCompany}. Personality: ${selectedScenario.prospectPersonality}`,
          },
        },
      });
      if (error) throw error;

      setPhoneSessionId(data.sessionId);
      setPhoneCallStatus(data.status);
      setPhonePolling(true);
      toast.success("Calling your phone now! Pick up to start practicing.");
    } catch (e: any) {
      toast.error("Failed to start call: " + (e.message || "Unknown error"));
      setCallState("scenario_detail");
    }
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
            businessContext: businessContext || undefined,
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
      const history = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const { data, error } = await supabase.functions.invoke("practice-call", {
        body: {
          action: "respond",
          scenarioId: selectedScenario?.id,
          messages: history,
          businessContext: businessContext || undefined,
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

      const totalMessages = messages.filter(m => m.role === "user").length + 1;
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

  // ========================
  // IDLE STATE - Scenario Browse
  // ========================
  if (callState === "idle") {
    // Compute progress data
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
            <div className="flex items-center gap-1 bg-muted rounded-full p-1">
              <button
                onClick={() => setTopTab("practice")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  topTab === "practice" ? "bg-foreground text-background" : "text-muted-foreground"
                }`}
              >
                <Gamepad2 className="h-4 w-4" />New Practice
              </button>
              <button
                onClick={() => setTopTab("results")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  topTab === "results" ? "bg-foreground text-background" : "text-muted-foreground"
                }`}
              >
                <History className="h-4 w-4" />Past Results
              </button>
              <button
                onClick={() => setTopTab("progress")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  topTab === "progress" ? "bg-foreground text-background" : "text-muted-foreground"
                }`}
              >
                <ChartLine className="h-4 w-4" />Progress
              </button>
            </div>
          </div>
          <p className="text-muted-foreground">
            {topTab === "practice" ? "Sharpen your skills through live AI role plays that drop you into realistic scenarios." :
             topTab === "results" ? "Review your past practice sessions and track your improvement over time." :
             "See your improvement over time with beautiful charts showing your progress."}
          </p>
        </div>

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
                              <Phone className="h-3 w-3" />Practice
                            </Badge>
                          </td>
                          <td className="py-3 px-2 text-right">
                            <span className={`text-2xl font-bold ${
                              score >= 70 ? "text-emerald-600 dark:text-emerald-400" :
                              score >= 40 ? "text-amber-600 dark:text-amber-400" :
                              "text-red-600 dark:text-red-400"
                            }`}>{score}</span>
                            <span className={`ml-1 inline-block w-8 h-2 rounded-full ${
                              score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500"
                            }`} />
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
                  const chartData = sorted.map((s: any, i: number) => ({
                    name: `#${i + 1}`,
                    score: s.overall_score || 0,
                  }));

                  return (
                    <Card key={name}>
                      <CardContent className="py-5">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                              <Gamepad2 className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <h4 className="font-bold">{name}</h4>
                              <p className="text-xs text-muted-foreground">
                                {sessions.length} attempts • Best: <span className="font-bold">{best}</span> • Avg: <span className="font-bold">{avg}</span>
                              </p>
                            </div>
                          </div>
                          {isImproving && (
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                              <TrendingUp className="h-3 w-3 mr-1" />Improving
                            </Badge>
                          )}
                        </div>
                        <div className="h-40">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                              <XAxis dataKey="name" className="text-xs" />
                              <YAxis domain={[0, 100]} className="text-xs" />
                              <Tooltip />
                              <Area type="monotone" dataKey="score" stroke="hsl(var(--foreground))" fill="hsl(var(--muted))" strokeWidth={2} dot={{ r: 4, fill: "hsl(var(--foreground))" }} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* NEW PRACTICE TAB (original scenario grid) */}
        {topTab === "practice" && (
          <>
            {/* Category Tabs */}
            <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
              {SCENARIO_CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                    activeCategory === cat.id
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <cat.icon className="h-4 w-4" />
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Grouped Scenarios */}
            {(activeCategory === "all" ? SCENARIO_CATEGORIES.filter(c => c.id !== "all") : SCENARIO_CATEGORIES.filter(c => c.id === activeCategory)).map(cat => {
              const categoryScenarios = RICH_SCENARIOS.filter(s => s.category === cat.id);
              if (categoryScenarios.length === 0) return null;
              return (
                <div key={cat.id} className="mb-10">
                  <div className="flex items-center gap-2 mb-4">
                    <cat.icon className="h-5 w-5 text-primary" />
                    <h2 className="text-xl font-bold">{cat.label}</h2>
                    <div className="h-0.5 flex-1 bg-primary/20 rounded-full ml-2" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {categoryScenarios.map(scenario => (
                      <Card
                        key={scenario.id}
                        className="cursor-pointer hover:border-primary/50 transition-all hover:shadow-lg group"
                        onClick={() => openScenarioDetail(scenario)}
                      >
                        <CardContent className="py-5">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-bold text-base">{scenario.name}</h3>
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                <Badge className={`text-xs ${difficultyColor[scenario.difficulty]}`}>
                                  {scenario.difficulty}
                                </Badge>
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" />{scenario.duration}
                                </span>
                              </div>
                            </div>
                            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0 ml-3">
                              <User className="h-6 w-6 text-muted-foreground" />
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{scenario.description}</p>
                          <div className="bg-muted/50 rounded-lg p-2.5 text-xs">
                            <p className="font-medium mb-0.5">You'll be speaking with:</p>
                            <p className="flex items-center gap-1">
                              <User className="h-3 w-3" />{scenario.prospectName} - {scenario.prospectRole}
                            </p>
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

        {/* Business Setup Dialog */}
        {showBusinessSetup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="max-w-lg w-full">
              <CardContent className="py-6 space-y-4">
                <div className="text-center">
                  <h2 className="text-xl font-bold">Set Up Your Business</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Practice scenarios work best when the AI knows your business context.
                  </p>
                </div>
                <Textarea
                  value={businessContext}
                  onChange={(e) => setBusinessContext(e.target.value)}
                  placeholder="Describe your business..."
                  rows={5}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => setShowBusinessSetup(false)}>Save & Close</Button>
                  <Button variant="outline" onClick={() => setShowBusinessSetup(false)}>Maybe Later</Button>
                </div>
              </CardContent>
            </Card>
          </div>
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
          {/* Phone mockup */}
          <div className="lg:col-span-2">
            <div className="border-[8px] border-foreground rounded-[2.5rem] p-1 max-w-[280px] mx-auto bg-background">
              <div className="rounded-[2rem] overflow-hidden">
                {/* Phone notch */}
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
                  <div className="pt-6">
                    <Button
                      size="lg"
                      className="h-16 w-16 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={startCall}
                    >
                      <Phone className="h-7 w-7" />
                    </Button>
                  </div>
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
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span>•</span>{obj}
                      </li>
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
                            <li key={i} className="text-sm flex items-start gap-2 text-emerald-700 dark:text-emerald-400">
                              <span>🟢</span>{m}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {learnContent.commonMistakes?.length > 0 && (
                      <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
                        <h4 className="font-semibold text-sm flex items-center gap-1.5 mb-2">🚫 Common Mistakes</h4>
                        <ul className="space-y-1">
                          {learnContent.commonMistakes.map((m: string, i: number) => (
                            <li key={i} className="text-sm flex items-start gap-2 text-red-600 dark:text-red-400">
                              <span>🟠</span>{m}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {learnContent.proTips?.length > 0 && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4">
                        <h4 className="font-semibold text-sm flex items-center gap-1.5 mb-2">💡 Pro Tips from Your Brain</h4>
                        <ul className="space-y-1">
                          {learnContent.proTips.map((t: string, i: number) => (
                            <li key={i} className="text-sm flex items-start gap-2">
                              <Lightbulb className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />{t}
                            </li>
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
                        <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                          <span>•</span>"{obj}"
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="business" className="mt-4 space-y-4">
                <h3 className="font-bold">Scenario Context</h3>
                {businessContext ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">This scenario will use your business context to make the practice realistic.</p>
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Your Business</p>
                      <p className="text-sm">{businessContext}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 space-y-3">
                    <p className="text-sm text-muted-foreground">No business context set. The AI will use a generic scenario.</p>
                    <Button variant="outline" onClick={() => setShowBusinessSetup(true)}>
                      <Target className="h-4 w-4 mr-2" />Set Up Your Business
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {/* Phone Call Option */}
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <Phone className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Call My Phone</span>
                <Badge variant="outline" className="text-[10px]">Real Call</Badge>
              </div>
              <div className="flex gap-2">
                <Input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  className="flex-1"
                  type="tel"
                />
                <Button onClick={startPhoneCall} disabled={!phoneNumber.trim()} className="shrink-0">
                  <Phone className="h-4 w-4 mr-2" />Call Me
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                We'll call your phone. The AI prospect will answer based on this scenario.
              </p>
            </div>

            <div className="relative flex items-center my-4">
              <div className="flex-1 h-px bg-border" />
              <span className="px-3 text-xs text-muted-foreground">or practice via text</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <Button variant="outline" className="w-full h-12 text-base" onClick={startCall}>
              <Gamepad2 className="h-5 w-5 mr-2" />
              Start Text Practice →
            </Button>
          </div>
        </div>

        {showBusinessSetup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="max-w-lg w-full">
              <CardContent className="py-6 space-y-4">
                <h2 className="text-xl font-bold text-center">Set Up Your Business</h2>
                <Textarea
                  value={businessContext}
                  onChange={(e) => setBusinessContext(e.target.value)}
                  placeholder="Describe your business, product, who you sell to, and common objections..."
                  rows={5}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => setShowBusinessSetup(false)}>Save</Button>
                  <Button variant="outline" onClick={() => setShowBusinessSetup(false)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }

  // ========================
  // PHONE RINGING STATE (Real Twilio call)
  // ========================
  if (callState === "phone_ringing") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-6">
        <div className="relative">
          <div className="h-24 w-24 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
            <Phone className="h-10 w-10 text-primary animate-bounce" />
          </div>
          <div className="absolute -inset-4 rounded-full border-2 border-primary/30 animate-ping" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold">Calling Your Phone</h2>
          <p className="text-sm text-muted-foreground">{phoneNumber}</p>
          <p className="text-muted-foreground animate-pulse mt-2">
            {phoneCallStatus === "ringing" ? "Ringing..." : "Connecting..."}
          </p>
          <p className="text-xs text-muted-foreground mt-3">Pick up to talk with {selectedScenario?.prospectName}</p>
        </div>
        <Button variant="destructive" size="lg" onClick={() => {
          setPhonePolling(false);
          setCallState("scenario_detail");
        }}>
          <PhoneOff className="h-5 w-5 mr-2" />Cancel
        </Button>
      </div>
    );
  }

  // ========================
  // PHONE CONNECTED STATE (Real Twilio call in progress)
  // ========================
  if (callState === "phone_connected") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-6">
        <div className="relative">
          <div className="h-24 w-24 rounded-full bg-primary/20 flex items-center justify-center">
            <Mic className="h-10 w-10 text-primary animate-pulse" />
          </div>
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold">Call In Progress</h2>
          <p className="text-sm text-muted-foreground">
            Speaking with {selectedScenario?.prospectName} — {selectedScenario?.name}
          </p>
          <div className="flex items-center gap-2 justify-center mt-2">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="text-sm text-primary">Live</span>
          </div>
        </div>

        {/* Live transcript */}
        {phoneTranscript.length > 0 && (
          <Card className="max-w-lg w-full">
            <CardContent className="py-4">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />Live Transcript
              </h3>
              <ScrollArea className="max-h-48">
                <div className="space-y-2">
                  {phoneTranscript.map((turn, i) => (
                    <div key={i} className={`text-sm ${turn.role === "user" ? "text-primary font-medium" : "text-muted-foreground"}`}>
                      <span className="text-xs font-bold mr-1">{turn.role === "user" ? "You:" : `${selectedScenario?.prospectName}:`}</span>
                      {turn.text}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground max-w-sm text-center">
          Hang up the phone when you're done. Your transcript and coaching will appear automatically.
        </p>
      </div>
    );
  }

  // ========================
  // PHONE ENDED STATE (Post-call analysis)
  // ========================
  if (callState === "phone_ended") {
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
          🐺 {selectedScenario?.name} Practice
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
                      <Button variant="outline" size="sm" onClick={() => {
                        setPhoneTranscript([]);
                        setPhoneSessionId(null);
                        setPhoneAnalysis(null);
                        startPhoneCall();
                      }}>
                        Try Again
                      </Button>
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
                          {a.overallScore}
                          <span className="text-sm font-normal">/100</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Breakdown by Section */}
                  <div>
                    <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-primary" />Breakdown by Section
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
                              <span className={`text-sm font-bold px-2 py-0.5 rounded ${getScoreBadgeColor(section.score)}`}>
                                {section.score}/100
                              </span>
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
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                          <Zap className="h-5 w-5 text-primary" />Highlight Reel
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="rounded-xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="flex items-center gap-1 text-sm font-bold text-emerald-600 dark:text-emerald-400">⭐ Your Best Moment</span>
                              <span className="text-xs text-muted-foreground">{a.highlightReel.bestMoment.timestamp}</span>
                            </div>
                            <p className="text-sm font-medium mb-2 italic">"{a.highlightReel.bestMoment.quote}"</p>
                            <p className="text-xs text-muted-foreground">{a.highlightReel.bestMoment.explanation}</p>
                          </div>
                          <div className="rounded-xl border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="flex items-center gap-1 text-sm font-bold text-amber-600 dark:text-amber-400">🔶 Needs Work</span>
                              <span className="text-xs text-muted-foreground">{a.highlightReel.needsWork.timestamp}</span>
                            </div>
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
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-amber-500" />Key Takeaways
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="rounded-xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 p-4">
                            <h4 className="font-bold text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mb-3">
                              <CheckCircle2 className="h-4 w-4" /> What You Did Well
                            </h4>
                            <div className="space-y-2">
                              {a.keyTakeaways.didWell.map((item, i) => (
                                <p key={i} className="text-sm flex items-start gap-2"><span className="text-emerald-500 mt-0.5">✓</span>{item}</p>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-xl border border-border p-4">
                            <h4 className="font-bold text-sm flex items-center gap-1 mb-3">
                              <Lightbulb className="h-4 w-4 text-amber-500" /> Focus Areas
                            </h4>
                            <div className="space-y-2">
                              {a.keyTakeaways.focusAreas.map((item, i) => (
                                <p key={i} className="text-sm flex items-start gap-2">
                                  <span className="text-amber-500 font-bold mt-0.5">{i + 1}</span>
                                  <span className="text-muted-foreground">{item}</span>
                                </p>
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
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-bold text-lg flex items-center gap-2">
                            <Shield className="h-5 w-5 text-indigo-500" />Objection Replay
                          </h3>
                          <span className="text-sm text-muted-foreground">
                            {a.objectionReplay.filter(o => o.handled).length}/{a.objectionReplay.length} handled
                          </span>
                        </div>
                        <div className="space-y-3">
                          {a.objectionReplay.map((obj, i) => (
                            <div key={i} className={`rounded-xl p-4 border-l-4 ${
                              obj.handled ? "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10" : "border-l-red-400 bg-red-50/50 dark:bg-red-900/10"
                            }`}>
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
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                          <BarChart3 className="h-5 w-5 text-primary" />Call Analytics
                        </h3>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div className="rounded-xl border p-4">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-sm text-muted-foreground">Talk/Listen Ratio</p>
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <p className="text-2xl font-bold">{a.callAnalytics.talkListenRatio}%</p>
                            <p className={`text-xs flex items-center gap-1 ${getAnalyticStatus(a.callAnalytics.talkListenRatio, 40, 60) ? "text-emerald-600" : "text-red-500"}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${getAnalyticStatus(a.callAnalytics.talkListenRatio, 40, 60) ? "bg-emerald-500" : "bg-red-500"}`} />
                              Recommended: 40-60%
                            </p>
                          </div>
                          <div className="rounded-xl border p-4">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-sm text-muted-foreground">Talk Speed</p>
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <p className="text-2xl font-bold">{a.callAnalytics.talkSpeed} <span className="text-sm font-normal">wpm</span></p>
                            <p className={`text-xs flex items-center gap-1 ${getAnalyticStatus(a.callAnalytics.talkSpeed, 110, 160) ? "text-emerald-600" : "text-red-500"}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${getAnalyticStatus(a.callAnalytics.talkSpeed, 110, 160) ? "bg-emerald-500" : "bg-red-500"}`} />
                              Recommended: 110-160
                            </p>
                          </div>
                          <div className="rounded-xl border p-4">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-sm text-muted-foreground">Longest Monologue</p>
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <p className="text-2xl font-bold">{a.callAnalytics.longestMonologue}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Recommended: 10s-60s
                            </p>
                          </div>
                          <div className="rounded-xl border p-4">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-sm text-muted-foreground">Objections Handled</p>
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <p className="text-2xl font-bold">{a.callAnalytics.objectionsHandled}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />Recommended: 100%
                            </p>
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
                        <MessageSquare className="h-4 w-4 text-primary" />Full Call Transcript
                      </h3>
                      <div className="space-y-3">
                        {phoneTranscript.map((turn, i) => (
                          <div key={i} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                              turn.role === "user" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md"
                            }`}>
                              <p className="text-xs font-medium mb-1">{turn.role === "user" ? "You" : selectedScenario?.prospectName}</p>
                              <p className="text-sm">{turn.text}</p>
                            </div>
                          </div>
                        ))}
                        {phoneTranscript.length === 0 && (
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
                    {phoneTranscript.map((turn, i) => (
                      <div key={i} className={`text-sm ${turn.role === "user" ? "text-primary font-medium" : "text-muted-foreground"}`}>
                        <span className="text-xs font-bold mr-1">{turn.role === "user" ? "You:" : `${selectedScenario?.prospectName}:`}</span>
                        {turn.text}
                      </div>
                    ))}
                    {phoneTranscript.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No transcript recorded.</p>
                    )}
                  </div>
                  {phoneTranscript.length > 0 && (
                    <Button className="mt-4 w-full" onClick={() => analyzePhoneCall(phoneTranscript)}>
                      <Sparkles className="h-4 w-4 mr-2" />Analyze My Call
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button size="lg" className="bg-primary" onClick={() => {
            setPhoneTranscript([]);
            setPhoneSessionId(null);
            setPhoneAnalysis(null);
            startPhoneCall();
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
  // RINGING STATE (Text practice)
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
        <Button variant="destructive" size="lg" onClick={() => { setCallState("scenario_detail"); }}>
          <PhoneOff className="h-5 w-5 mr-2" />Cancel
        </Button>
      </div>
    );
  }

  // ========================
  // CONNECTED or ENDED STATE
  // ========================
  const lastCoaching = [...messages].reverse().find(m => m.coaching)?.coaching;

  // Post-practice analysis
  if (callState === "ended") {
    const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0;
    const bestScore = Math.max(...allScores, 0);
    const worstScore = Math.min(...allScores, 10);
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

        {/* Score Overview */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6 sm:mb-8">
          <Card>
            <CardContent className="p-3 sm:py-4 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">Overall Score</p>
              <p className={`text-xl sm:text-3xl font-bold ${getScoreColor(avgScore)}`}>{avgScore}/10</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:py-4 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">Messages Sent</p>
              <p className="text-xl sm:text-3xl font-bold">{userMsgCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:py-4 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">Best Turn</p>
              <p className={`text-xl sm:text-3xl font-bold ${getScoreColor(bestScore)}`}>{bestScore}/10</p>
            </CardContent>
          </Card>
        </div>

        {/* Score Progression */}
        {allScores.length > 1 && (
          <Card className="mb-6">
            <CardContent className="py-4">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />Score Progression
              </h3>
              <div className="flex items-end gap-1 h-20">
                {allScores.map((s, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">{s}</span>
                    <div
                      className={`w-full rounded-t ${s >= 8 ? "bg-emerald-500" : s >= 5 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ height: `${(s / 10) * 100}%` }}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Techniques & Feedback */}
        <div className="grid grid-cols-1 gap-3 sm:gap-4 mb-4 sm:mb-6">
          {uniqueTechniques.length > 0 && (
            <Card>
              <CardContent className="py-4">
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />Techniques Used
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {uniqueTechniques.map((t, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{t}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="py-4">
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />Stages Reached
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {uniqueStages.map((s, i) => (
                  <Badge key={i} className={`text-xs ${getStageColor(s)}`}>{s}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Coach Summary */}
        <Card className="mb-6">
          <CardContent className="py-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />Coach Feedback Summary
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {allFeedback.filter(Boolean).map((fb, i) => (
                <p key={i} className="text-xs text-muted-foreground border-l-2 border-primary/20 pl-2">{fb}</p>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Overall Assessment */}
        <Card className="mb-8 border-primary/20">
          <CardContent className="py-5 text-center">
            <p className="text-sm font-medium mb-1">
              {avgScore >= 8 ? "🔥 Outstanding! You're a natural closer!" :
               avgScore >= 6 ? "💪 Good work! Keep practicing to sharpen your skills." :
               avgScore >= 4 ? "📈 Not bad! Focus on asking more questions and building rapport." :
               "🎯 Keep at it! Review the coaching tips and try again."}
            </p>
            <p className="text-xs text-muted-foreground">
              {avgScore >= 8 ? "You demonstrated strong sales techniques and read the prospect well." :
               avgScore >= 6 ? "You showed good instincts. Work on your discovery questions." :
               "Try to listen more, ask deeper questions, and don't pitch too early."}
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center">
          <Button variant="outline" size="sm" className="text-xs sm:text-sm" onClick={resetCall}>
            <RotateCcw className="h-4 w-4 mr-1 sm:mr-2" />Try Another
          </Button>
          <Button size="sm" className="text-xs sm:text-sm" onClick={() => { setCallState("ringing"); setMessages([]); setAllScores([]); setAllFeedback([]); setAllTechniques([]); setAllStages([]); startCall(); }}>
            <Phone className="h-4 w-4 mr-1 sm:mr-2" />Retry Scenario
          </Button>
        </div>
      </div>
    );
  }

  // ========================
  // CONNECTED STATE - Chat
  // ========================
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="border-b px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between bg-background/95 backdrop-blur shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <div className="min-w-0">
            <h2 className="font-semibold text-xs sm:text-sm truncate">{selectedScenario?.prospectName} — {selectedScenario?.name}</h2>
            <div className="flex items-center gap-2">
              {lastCoaching && (
                <Badge className={`text-[10px] ${getStageColor(lastCoaching.conversationStage)}`}>
                  {lastCoaching.conversationStage}
                </Badge>
              )}
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
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted rounded-bl-md"
                  }`}>
                    <p className="text-sm">{msg.content}</p>
                  </div>
                </div>
                {msg.coaching && (
                  <div className="mt-2 ml-2 p-3 rounded-lg bg-primary/5 border border-primary/10 max-w-[85%]">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="h-3 w-3 text-primary" />
                      <span className="text-xs font-medium text-primary">Coach</span>
                      {msg.coaching.score > 0 && (
                        <span className={`text-xs font-bold ${getScoreColor(msg.coaching.score)}`}>
                          {msg.coaching.score}/10
                        </span>
                      )}
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

      <div className="border-t p-4 bg-background">
        <div className="max-w-2xl mx-auto flex gap-2">
          <Input
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Type your response to the prospect..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button onClick={sendMessage} disabled={!inputText.trim() || isLoading} size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
