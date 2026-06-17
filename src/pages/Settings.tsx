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
  const [supadataLabel, setSupadataLabel] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  type TranscriptKey = { id: string; label: string; masked: string; updatedAt: string };
  const [transcriptKeys, setTranscriptKeys] = useState<TranscriptKey[]>([]);

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
    setAiSaving(true);
    try {
      await supabase.functions.invoke("manage-api-keys", { body: { action: "switch_to_lovable" } });
      setActiveAi(null);
      toast.success("AI key removed — back to the built-in AI.");
    } catch (e: any) {
      toast.error(e.message || "Failed to remove key");
    } finally {
      setAiSaving(false);
    }
  };

  const selectedProvider = AI_PROVIDERS.find((p) => p.value === aiProvider) || AI_PROVIDERS[0];

  const loadTranscriptKeys = useCallback(async () => {
    const { data } = await supabase.functions.invoke("manage-api-keys", {
      body: { action: "list", service: "supadata" },
    });
    setTranscriptKeys(data?.keys || []);
  }, []);

  useEffect(() => {
    if (user) { loadTranscriptKeys(); }
  }, [user, loadTranscriptKeys]);

  const handleSaveKey = async () => {
    if (!supadataKey.trim()) {
      toast.error("Please enter an API key");
      return;
    }
    setIsSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-api-keys", {
        body: {
          action: "save",
          service: "supadata",
          apiKey: supadataKey.trim(),
          label: supadataLabel.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSupadataKey("");
      setSupadataLabel("");
      await loadTranscriptKeys();
      toast.success("API key added — it will be used for transcript extraction.");
    } catch (error: any) {
      toast.error(error.message || "Failed to save API key");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTranscriptKey = async (id: string) => {
    try {
      const { error } = await supabase.functions.invoke("manage-api-keys", {
        body: { action: "delete_by_id", id },
      });
      if (error) throw error;
      setTranscriptKeys((prev) => prev.filter((k) => k.id !== id));
      toast.success("API key removed");
    } catch (e: any) {
      toast.error(e.message || "Failed to remove key");
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
              AI Provider
            </CardTitle>
            <CardDescription>
              Choose which AI powers the app. By default everything runs on the built-in <strong>Lovable AI</strong> (no key needed). Add your own OpenAI / Gemini / Anthropic key to switch processing to your account and remove the shared usage limit. Remove your key any time to switch back to Lovable AI.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
              <div className="text-sm">
                <span className="text-muted-foreground">Currently using: </span>
                {activeAi ? (
                  <>
                    <span className="font-medium">{AI_PROVIDERS.find((p) => p.value === activeAi.provider)?.label.split(" (")[0]}</span>
                    <code className="ml-2 bg-muted px-2 py-0.5 rounded text-xs">{activeAi.masked}</code>
                    <code className="ml-2 bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-medium">
                      {activeAi.provider === "openai" ? "gpt-4o-mini"
                        : activeAi.provider === "gemini" ? "gemini-2.5-flash"
                        : "claude-sonnet-4-6"}
                    </code>
                  </>
                ) : (
                  <>
                    <span className="font-medium">Lovable AI (built-in)</span>
                    <code className="ml-2 bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-medium">
                      google/gemini-3.5-flash
                    </code>
                  </>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={handleRemoveAiKey} disabled={aiSaving || !activeAi}>
                Switch to Lovable AI
              </Button>
            </div>


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
              Add one or more API keys to extract YouTube transcripts. The app rotates
              through them automatically — if one hits its limit, the next is used.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Get keys from{" "}
                <a href="https://transcriptapi.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  transcriptapi.com
                </a>
                . You can add multiple keys (e.g. from different accounts) so re-extraction
                doesn't fail when one runs out of credits. Keys are stored encrypted on the
                server and never sent back to the browser.
              </AlertDescription>
            </Alert>

            {transcriptKeys.length > 0 && (
              <div className="space-y-2">
                <Label>Saved keys ({transcriptKeys.length})</Label>
                <div className="space-y-2">
                  {transcriptKeys.map((k) => (
                    <div key={k.id} className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{k.label}</div>
                        <code className="text-xs text-muted-foreground">{k.masked}</code>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteTranscriptKey(k.id)}
                        aria-label={`Remove ${k.label}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 pt-2 border-t">
              <Label htmlFor="supadata-label">Label (optional)</Label>
              <Input
                id="supadata-label"
                type="text"
                value={supadataLabel}
                onChange={(e) => setSupadataLabel(e.target.value)}
                placeholder="e.g. Account 1, Backup, Work account"
                maxLength={60}
              />
            </div>

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
              <Plus className="h-4 w-4 mr-2" />
              {isSaving ? "Adding..." : "Add Key"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
