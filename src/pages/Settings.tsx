import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Settings as SettingsIcon, Key, Save, AlertTriangle, Bot, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const AI_PROVIDERS = [
  { value: "gemini", label: "Google Gemini (free tier — recommended)", help: "Get a free key at aistudio.google.com/apikey", placeholder: "AIza..." },
  { value: "openai", label: "OpenAI (ChatGPT)", help: "Get a key at platform.openai.com/api-keys", placeholder: "sk-..." },
  { value: "anthropic", label: "Anthropic (Claude)", help: "Get a key at console.anthropic.com", placeholder: "sk-ant-..." },
] as const;

export default function Settings() {
  const { user } = useAuth();
  const [supadataKey, setSupadataKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [currentKeyMasked, setCurrentKeyMasked] = useState("");

  // ─── Bring-your-own AI provider key ───
  const [aiProvider, setAiProvider] = useState<string>("gemini");
  const [aiKey, setAiKey] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [activeAi, setActiveAi] = useState<{ provider: string; masked: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      let latest: { provider: string; masked: string; updatedAt: string } | null = null;
      for (const p of AI_PROVIDERS) {
        const { data } = await supabase.functions.invoke("manage-api-keys", {
          body: { action: "check", service: p.value },
        });
        if (data?.exists && (!latest || (data.updatedAt || "") > latest.updatedAt)) {
          latest = { provider: p.value, masked: data.masked, updatedAt: data.updatedAt || "" };
        }
      }
      if (latest) { setActiveAi({ provider: latest.provider, masked: latest.masked }); setAiProvider(latest.provider); }
    })();
  }, [user]);

  const handleSaveAiKey = async () => {
    if (!aiKey.trim()) { toast.error("Please paste your AI API key"); return; }
    setAiSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-api-keys", {
        body: { action: "save", service: aiProvider, apiKey: aiKey.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const k = aiKey.trim();
      setActiveAi({ provider: aiProvider, masked: k.substring(0, 8) + "..." + k.substring(k.length - 4) });
      setAiKey("");
      toast.success("AI key saved! The app will use your own AI for processing.");
    } catch (e: any) {
      toast.error(e.message || "Failed to save AI key");
    } finally {
      setAiSaving(false);
    }
  };

  const handleRemoveAiKey = async () => {
    if (!activeAi) return;
    setAiSaving(true);
    try {
      await supabase.functions.invoke("manage-api-keys", { body: { action: "delete", service: activeAi.provider } });
      setActiveAi(null);
      toast.success("AI key removed — back to the built-in AI.");
    } catch (e: any) {
      toast.error(e.message || "Failed to remove key");
    } finally {
      setAiSaving(false);
    }
  };

  const selectedProvider = AI_PROVIDERS.find((p) => p.value === aiProvider) || AI_PROVIDERS[0];

  // Check if key exists via edge function
  useEffect(() => {
    if (user) {
      supabase.functions.invoke("manage-api-keys", {
        body: { action: "check", service: "supadata" },
      }).then(({ data }) => {
        if (data?.exists) {
          setCurrentKeyMasked(data.masked);
        }
      });
    }
  }, [user]);

  const handleSaveKey = async () => {
    if (!supadataKey.trim()) {
      toast.error("Please enter an API key");
      return;
    }
    setIsSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-api-keys", {
        body: { action: "save", service: "supadata", apiKey: supadataKey.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Update masked display
      const key = supadataKey.trim();
      setCurrentKeyMasked(key.substring(0, 8) + "..." + key.substring(key.length - 4));
      setSupadataKey("");
      toast.success("API key saved securely!");
    } catch (error: any) {
      toast.error(error.message || "Failed to save API key");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="px-4 py-6 overflow-x-hidden">
      <div className="mb-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-primary" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">Manage your configuration and API keys</p>
      </div>

      <div className="space-y-6">
        {/* Bring-your-own AI provider */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bot className="h-5 w-5" />
              Your AI Provider (use your own AI)
            </CardTitle>
            <CardDescription>
              Add your own AI API key so all processing — learning from books/videos, the AI chat, reply suggestions and more — runs on YOUR account instead of the built-in AI. This removes the usage limit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeAi && (
              <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
                <div className="text-sm">
                  <span className="text-muted-foreground">Active: </span>
                  <span className="font-medium">{AI_PROVIDERS.find((p) => p.value === activeAi.provider)?.label.split(" (")[0]}</span>
                  <code className="ml-2 bg-muted px-2 py-0.5 rounded text-xs">{activeAi.masked}</code>
                </div>
                <Button variant="ghost" size="sm" onClick={handleRemoveAiKey} disabled={aiSaving}>Remove</Button>
              </div>
            )}

            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={aiProvider} onValueChange={setAiProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{selectedProvider.help}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">API Key</Label>
              <Input
                id="ai-key"
                type="password"
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                placeholder={selectedProvider.placeholder}
              />
              <p className="text-xs text-muted-foreground">Stored encrypted on the server, never shown back to the browser.</p>
            </div>

            <Button onClick={handleSaveAiKey} disabled={aiSaving || !aiKey.trim()}>
              <Save className="h-4 w-4 mr-2" />
              {aiSaving ? "Saving..." : "Save AI Key"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Key className="h-5 w-5" />
              YouTube Transcript API Key
            </CardTitle>
            <CardDescription>
               Used for extracting YouTube video transcripts automatically via TranscriptAPI.com.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Get your API key from{" "}
                <a href="https://transcriptapi.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  transcriptapi.com
                </a>
                . Your key is stored securely on the server and never sent back to the browser. Depending on TranscriptAPI.com's account rules, transcript extraction may require an active paid plan even if credits are available.
              </AlertDescription>
            </Alert>

            {currentKeyMasked && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Current key:</span>
                <code className="bg-muted px-2 py-1 rounded text-xs">{currentKeyMasked}</code>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="supadata-key">New API Key</Label>
              <Input
                id="supadata-key"
                type="password"
                value={supadataKey}
                onChange={(e) => setSupadataKey(e.target.value)}
                placeholder="sk_..."
              />
            </div>

            <Button onClick={handleSaveKey} disabled={isSaving || !supadataKey.trim()}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? "Saving..." : "Save API Key"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
