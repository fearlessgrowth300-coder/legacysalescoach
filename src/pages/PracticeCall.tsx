import { useState, useRef, useEffect } from "react";
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
  TrendingUp, BarChart3, CheckCircle2, XCircle, ArrowLeft, User
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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

type CallState = "idle" | "scenario_detail" | "ringing" | "connected" | "ended";

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const filteredScenarios = activeCategory === "all"
    ? RICH_SCENARIOS
    : RICH_SCENARIOS.filter(s => s.category === activeCategory);

  const openScenarioDetail = (scenario: RichScenario) => {
    setSelectedScenario(scenario);
    setCallState("scenario_detail");
    setActiveDetailTab("scene");
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
    return (
      <div className="px-4 py-6 md:py-8 max-w-5xl mx-auto overflow-x-hidden">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-xl md:text-3xl font-bold flex items-center gap-2 md:gap-3">
              Practice <Gamepad2 className="h-6 w-6 md:h-8 md:w-8 text-primary" />
            </h1>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowBusinessSetup(true)}>
                <Target className="h-4 w-4 mr-1" />
                {businessContext ? "Your Biz" : "Set Up"}
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground">
            Sharpen your skills through live AI role plays that drop you into realistic scenarios.
          </p>
        </div>

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
          {businessContext && (
            <div className="flex items-center gap-1.5 ml-auto text-sm text-muted-foreground">
              <span className="text-amber-500">💡</span>
              <span className="font-medium">Your Biz</span>
              <span>= practice selling your product</span>
            </div>
          )}
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
                            {businessContext && (
                              <Badge variant="outline" className="text-xs">💡 Your Biz</Badge>
                            )}
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
                  placeholder="Describe your business, product, or opportunity. E.g., 'I sell health supplements through a network marketing company. Our flagship product is...' Include what you sell, who you sell to, and common objections you face."
                  rows={5}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => setShowBusinessSetup(false)}>
                    Save & Close
                  </Button>
                  <Button variant="outline" onClick={() => setShowBusinessSetup(false)}>
                    Maybe Later
                  </Button>
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
                {selectedScenario.examplePhrases && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">💬 Example Phrases</h4>
                    <div className="space-y-2">
                      {selectedScenario.examplePhrases.map((phrase, i) => (
                        <div key={i} className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground border-l-2 border-primary/30">
                          {phrase}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedScenario.successMetrics && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5 mb-2">✅ Success Metrics</h4>
                    <ul className="space-y-1">
                      {selectedScenario.successMetrics.map((m, i) => (
                        <li key={i} className="text-sm flex items-start gap-2 text-emerald-700 dark:text-emerald-400">
                          <span>🟢</span>{m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedScenario.commonMistakes && (
                  <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5 mb-2">🚫 Common Mistakes</h4>
                    <ul className="space-y-1">
                      {selectedScenario.commonMistakes.map((m, i) => (
                        <li key={i} className="text-sm flex items-start gap-2 text-red-600 dark:text-red-400">
                          <span>🟠</span>{m}
                        </li>
                      ))}
                    </ul>
                  </div>
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

            <Button className="w-full mt-6 h-12 text-base" onClick={startCall}>
              <Gamepad2 className="h-5 w-5 mr-2" />
              Start Practice →
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
  // RINGING STATE
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
