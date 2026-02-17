import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import {
  MessageSquareText,
  Brain,
  Upload,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Shield,
  Zap
} from "lucide-react";

export default function Home() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate("/chats");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-primary" />
            <span className="font-semibold text-base">Sales Reply Coach</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/login")}>Sign In</Button>
            <Button size="sm" onClick={() => navigate("/signup")}>Sign Up</Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-5 pt-10 pb-8 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-4">
          <Sparkles className="h-3.5 w-3.5" />
          Your personal sales coach
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-4">
          Say the right thing in <span className="text-primary">every conversation</span>
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Feel stuck or unsure what to say? Get human-sounding reply suggestions based on your own sales knowledge.
        </p>
        <Button size="lg" onClick={() => navigate("/signup")} className="gap-2 w-full">
          Get Started Free <ArrowRight className="h-4 w-4" />
        </Button>
      </section>

      {/* How it works */}
      <section className="px-5 py-8 bg-muted/50">
        <h2 className="text-xl font-bold mb-2 text-center">How It Works</h2>
        <p className="text-xs text-muted-foreground text-center mb-6">Three simple steps</p>
        <div className="space-y-3">
          {[
            { icon: Upload, title: "1. Upload or Paste", desc: "Screenshot a conversation or paste text. AI extracts the context." },
            { icon: Brain, title: "2. Train Your Brain", desc: "Upload sales videos & PDFs. The AI learns your style." },
            { icon: MessageSquareText, title: "3. Get Suggestions", desc: "Receive natural reply suggestions. Copy & send with confidence." },
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3 bg-card rounded-xl p-4 border">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <step.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-0.5">{step.title}</h3>
                <p className="text-xs text-muted-foreground">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="px-5 py-8">
        <h2 className="text-xl font-bold mb-4">Sound authentic, not salesy</h2>
        <div className="space-y-3">
          {[
            "Never freeze up when receiving a DM",
            "Handle objections with confidence",
            "Transition smoothly from friend to expert",
            "Sound natural, not robotic",
          ].map((b, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span className="text-sm">{b}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 py-10 bg-primary text-primary-foreground text-center">
        <h2 className="text-xl font-bold mb-3">Ready to feel confident?</h2>
        <p className="text-sm text-primary-foreground/80 mb-5">Never freeze up on replies again.</p>
        <Button size="lg" variant="secondary" onClick={() => navigate("/signup")} className="gap-2 w-full">
          Start Free Today <ArrowRight className="h-4 w-4" />
        </Button>
      </section>

      <footer className="py-6 border-t text-center text-xs text-muted-foreground px-4">
        <p>Sales Reply Coach — Your confidence coach for sales conversations</p>
      </footer>
    </div>
  );
}
