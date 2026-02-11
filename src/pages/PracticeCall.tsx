import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Phone, PhoneOff, Send, Loader2, Star, Target, Lightbulb,
  MessageSquare, Trophy, RotateCcw, ChevronRight, Sparkles, Mic
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";


type Scenario = {
  id: string;
  name: string;
  description: string;
  prospectPersona: string;
};

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

type CallState = "idle" | "ringing" | "connected" | "ended";

export default function PracticeCall() {
  const { user } = useAuth();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [overallScore, setOverallScore] = useState(0);
  const [businessContext, setBusinessContext] = useState("");
  const [showBusinessInput, setShowBusinessInput] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadScenarios();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadScenarios = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("practice-call", {
        body: { action: "list_scenarios" },
      });
      if (error) throw error;
      setScenarios(data.scenarios || []);
    } catch (e) {
      console.error("Failed to load scenarios:", e);
      // Fallback scenarios
      setScenarios([
        { id: "sell_pen", name: "Sell Me This Pen", description: "Classic sales challenge", prospectPersona: "" },
        { id: "cold_approach", name: "Cold DM Approach", description: "Start a conversation naturally on Instagram", prospectPersona: "" },
        { id: "network_marketing_invite", name: "Network Marketing Invite", description: "Invite a warm contact to look at your opportunity", prospectPersona: "" },
        { id: "objection_price", name: "Handle Price Objection", description: "They love it but say it's too expensive", prospectPersona: "" },
        { id: "follow_up", name: "Follow Up Call", description: "Re-engage someone who said 'let me think about it'", prospectPersona: "" },
        { id: "referral_ask", name: "Ask for Referrals", description: "Get referrals from a happy customer", prospectPersona: "" },
      ]);
    }
  };

  const startCall = async (scenario: Scenario) => {
    setSelectedScenario(scenario);
    setCallState("ringing");
    setMessages([]);
    setOverallScore(0);

    // Simulate ringing
    setTimeout(async () => {
      setCallState("connected");
      setIsLoading(true);

      try {
        const { data, error } = await supabase.functions.invoke("practice-call", {
          body: {
            action: "start",
            scenarioId: scenario.id,
            businessContext: businessContext || undefined,
          },
        });
        if (error) throw error;

        setMessages([{
          role: "assistant",
          content: data.prospectResponse,
          coaching: {
            coachFeedback: data.coachFeedback,
            techniqueUsed: data.techniqueUsed || "none",
            score: data.score || 5,
            tips: data.tips || [],
            conversationStage: data.conversationStage || "opening",
          },
        }]);
      } catch (e: any) {
        toast.error("Failed to start call: " + (e.message || "Unknown error"));
        setCallState("idle");
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
      // Build message history for AI
      const history = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.role === "assistant" ? m.content : m.content,
      }));

      const { data, error } = await supabase.functions.invoke("practice-call", {
        body: {
          action: "respond",
          scenarioId: selectedScenario?.id,
          messages: history,
          businessContext: businessContext || undefined,
        },
      });
      if (error) throw error;

      const score = data.score || 5;
      const totalMessages = messages.filter(m => m.role === "user").length + 1;
      setOverallScore(prev => Math.round(((prev * (totalMessages - 1)) + score) / totalMessages));

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

      // Check if conversation ended
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

  const endCall = () => {
    setCallState("ended");
  };

  const resetCall = () => {
    setCallState("idle");
    setSelectedScenario(null);
    setMessages([]);
    setOverallScore(0);
  };

  const getStageColor = (stage: string) => {
    const colors: Record<string, string> = {
      opening: "bg-blue-500/20 text-blue-400",
      rapport: "bg-green-500/20 text-green-400",
      discovery: "bg-purple-500/20 text-purple-400",
      presentation: "bg-amber-500/20 text-amber-400",
      objection: "bg-red-500/20 text-red-400",
      closing: "bg-emerald-500/20 text-emerald-400",
      won: "bg-green-500/20 text-green-400",
      lost: "bg-red-500/20 text-red-400",
    };
    return colors[stage] || "bg-muted text-muted-foreground";
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return "text-green-400";
    if (score >= 5) return "text-amber-400";
    return "text-red-400";
  };

  // IDLE STATE - Scenario Selection
  if (callState === "idle") {
    return (
      <div className="container py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Phone className="h-6 w-6 text-primary" />
            Practice Calls
          </h1>
          <p className="text-muted-foreground">Train your sales skills with AI-powered role-play scenarios</p>
        </div>

        {/* Business Context */}
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Your Business Context</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowBusinessInput(!showBusinessInput)}>
                {showBusinessInput ? "Hide" : businessContext ? "Edit" : "Add"}
              </Button>
            </div>
            {showBusinessInput && (
              <div className="mt-3">
                <Textarea
                  value={businessContext}
                  onChange={(e) => setBusinessContext(e.target.value)}
                  placeholder="Describe your business, product, or opportunity so the AI can tailor scenarios to you. E.g., 'I sell health supplements through a network marketing company called XYZ. Our flagship product is a weight loss shake...'"
                  rows={3}
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">This helps the AI make scenarios realistic for YOUR specific business</p>
              </div>
            )}
            {!showBusinessInput && businessContext && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-1">{businessContext}</p>
            )}
          </CardContent>
        </Card>

        {/* Scenarios Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scenarios.map((scenario) => (
            <Card
              key={scenario.id}
              className="cursor-pointer hover:border-primary/50 transition-all hover:shadow-md group"
              onClick={() => startCall(scenario)}
            >
              <CardContent className="py-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Phone className="h-4 w-4 text-primary" />
                      {scenario.name}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">{scenario.description}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // RINGING STATE
  if (callState === "ringing") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-6">
        <div className="relative">
          <div className="h-24 w-24 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
            <Phone className="h-10 w-10 text-primary animate-bounce" />
          </div>
          <div className="absolute -inset-4 rounded-full border-2 border-primary/30 animate-ping" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold">{selectedScenario?.name}</h2>
          <p className="text-muted-foreground animate-pulse">Calling...</p>
        </div>
        <Button variant="destructive" size="lg" onClick={resetCall}>
          <PhoneOff className="h-5 w-5 mr-2" />
          Cancel
        </Button>
      </div>
    );
  }

  // CONNECTED or ENDED STATE
  const lastCoaching = [...messages].reverse().find(m => m.coaching)?.coaching;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Call Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${callState === "connected" ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          <div>
            <h2 className="font-semibold text-sm">{selectedScenario?.name}</h2>
            <div className="flex items-center gap-2">
              {lastCoaching && (
                <Badge className={`text-[10px] ${getStageColor(lastCoaching.conversationStage)}`}>
                  {lastCoaching.conversationStage}
                </Badge>
              )}
              {callState === "ended" && <Badge variant="outline" className="text-[10px]">Call Ended</Badge>}
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
          {callState === "connected" ? (
            <Button variant="destructive" size="sm" onClick={endCall}>
              <PhoneOff className="h-4 w-4 mr-1" />End
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={resetCall}>
              <RotateCcw className="h-4 w-4 mr-1" />New Call
            </Button>
          )}
        </div>
      </div>

      {/* Messages + Coaching */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Area */}
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

                {/* Inline coaching for each AI response */}
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
                            <Lightbulb className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                            {tip}
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

      {/* Input Area */}
      {callState === "connected" && (
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
      )}

      {/* End Summary */}
      {callState === "ended" && (
        <div className="border-t p-6 bg-background">
          <div className="max-w-2xl mx-auto text-center space-y-4">
            <div className="flex items-center justify-center gap-2">
              <Trophy className={`h-6 w-6 ${getScoreColor(overallScore)}`} />
              <span className="text-2xl font-bold">Overall Score: {overallScore}/10</span>
            </div>
            <p className="text-muted-foreground text-sm">
              {overallScore >= 8 ? "Outstanding! You're a natural closer! 🔥" :
               overallScore >= 6 ? "Good work! Keep practicing to sharpen your skills. 💪" :
               overallScore >= 4 ? "Not bad! Focus on asking more questions and building rapport. 📈" :
               "Keep at it! Review the coaching tips and try again. 🎯"}
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={resetCall}>
                <RotateCcw className="h-4 w-4 mr-2" />Try Another Scenario
              </Button>
              <Button onClick={() => { resetCall(); if (selectedScenario) startCall(selectedScenario); }}>
                <Phone className="h-4 w-4 mr-2" />Retry Same Scenario
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
