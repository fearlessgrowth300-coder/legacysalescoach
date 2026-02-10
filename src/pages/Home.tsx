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
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-6 w-6 text-primary" />
            <span className="font-semibold text-lg">Sales Reply Coach</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => navigate("/login")}>
              Sign In
            </Button>
            <Button onClick={() => navigate("/signup")}>
              Sign Up
            </Button>
          </div>
        </div>
      </header>

      <section className="py-20 md:py-32">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Sparkles className="h-4 w-4" />
              Your personal sales conversation coach
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
              Say the right thing in{" "}
              <span className="text-primary">every sales conversation</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Feel stuck, nervous, or unsure what to say? Upload a screenshot or paste your conversation,
              and get human-sounding reply suggestions based on your own sales knowledge.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" onClick={() => navigate("/signup")} className="gap-2">
                Get Started Free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted/50">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Three simple steps to craft confident, authentic replies
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="bg-card rounded-xl p-6 border shadow-sm">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Upload className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">1. Upload or Paste</h3>
              <p className="text-muted-foreground">
                Screenshot a conversation or paste the text directly. Our AI extracts and understands the context.
              </p>
            </div>
            <div className="bg-card rounded-xl p-6 border shadow-sm">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Brain className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">2. Train Your Brain</h3>
              <p className="text-muted-foreground">
                Upload sales videos and PDFs to build your personalized knowledge base. The AI learns your style.
              </p>
            </div>
            <div className="bg-card rounded-xl p-6 border shadow-sm">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <MessageSquareText className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">3. Get Suggestions</h3>
              <p className="text-muted-foreground">
                Receive natural, human-sounding reply suggestions. Copy, modify, and send with confidence.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
            <div>
              <h2 className="text-3xl font-bold mb-6">
                Built for people who want to sound authentic, not salesy
              </h2>
              <div className="space-y-4">
                {[
                  "Never freeze up when receiving a DM again",
                  "Handle objections with confidence and grace",
                  "Smoothly transition from friend to expert mode",
                  "Know when to refer leads to team experts",
                  "Sound natural, not like a robot or script reader"
                ].map((benefit, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <span>{benefit}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-muted/50 rounded-2xl p-8 border">
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Shield className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold">You Stay in Control</h4>
                    <p className="text-sm text-muted-foreground">This is NOT automation. You decide what to send.</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Zap className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold">Instant Confidence</h4>
                    <p className="text-sm text-muted-foreground">Get suggestions in seconds when you feel stuck.</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Brain className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold">Your Knowledge, Amplified</h4>
                    <p className="text-sm text-muted-foreground">Suggestions are based on your own training materials.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-primary text-primary-foreground">
        <div className="container text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to feel confident in every conversation?</h2>
          <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
            Join sales professionals and network marketers who never freeze up on replies again.
          </p>
          <Button size="lg" variant="secondary" onClick={() => navigate("/signup")} className="gap-2">
            Start Free Today
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <footer className="py-8 border-t">
        <div className="container text-center text-sm text-muted-foreground">
          <p>Sales Reply Coach — Your confidence coach for sales conversations</p>
        </div>
      </footer>
    </div>
  );
}
