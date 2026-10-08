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
import {
  PROVIDER_MODEL,
  type ActiveAi,
  GEMINI_AVAILABLE_MODELS,
  getSelectedGeminiModel,
  setSelectedGeminiModel,
} from "@/hooks/useActiveAiModel";

const AI_PROVIDERS = [
  { value: "gemini", label: "Google Gemini (free tier — recommended)", help: "Get a free key at aistudio.google.com/apikey", placeholder: "AQ..." },
  { value: "openai", label: "OpenAI (ChatGPT)", help: "Get a key at platform.openai.com/api-keys", placeholder: "sk-..." },
  { value: "anthropic", label: "Anthropic (Claude)", help: "Get a key at console.anthropic.com", placeholder: "sk-ant-..." },
] as const;

// One optional Gemini key per step (server: user-ai.ts GEMINI_KEY_ROLES). Empty = main key.
const GEMINI_STEP_KEYS = [
  { service: "gemini_analysis", label: "Reading the chat & setting the stage", help: "Friend replies: reads the whole conversation first." },
  { service: "gemini_reply", label: "Writing the message", help: "Friend replies: writes the 3 reply options." },
  { service: "gemini_rewrite", label: "Checking & rewriting", help: "Friend replies: fixes a weak draft." },
  { service: "gemini_chat", label: "AI Chat", help: "The AI Chat page." },
] as const;

function GeminiStepKeys() {
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const entries = await Promise.all(GEMINI_STEP_KEYS.map(async ({ service }) => {
      const { data } = await supabase.functions.invoke("manage-api-keys", { body: { action: "check", service } });
      return [service, data?.exists ? data.masked : ""] as const;
    }));
    setSaved(Object.fromEntries(entries));
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const save = async (service: string) => {
    setBusy(service);
    try {
      const { data, error } = await supabase.functions.invoke("manage-api-keys", { body: { action: "save", service, apiKey: (drafts[service] || "").trim() } });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Could not save key");
      setDrafts((d) => ({ ...d, [service]: "" }));
      await load();
      toast.success("Key saved and checked with Google");
    } catch (e: any) { toast.error(e.message || "Could not save key"); }
    finally { setBusy(""); }
  };

  const remove = async (service: string) => {
    setBusy(service);
    try {
      await supabase.functions.invoke("manage-api-keys", { body: { action: "delete", service } });
      await load();
      toast.success("Removed — this step uses your main key again");
    } finally { setBusy(""); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><Key className="h-5 w-5" />Extra Gemini keys (optional)</CardTitle>
        <CardDescription>
          Give each step its own key so one key doesn't carry everything. Empty = uses your main key.
          Keys only spread the load if they come from different Google accounts/projects.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {GEMINI_STEP_KEYS.map(({ service, label, help }) => (
          <div key={service} className="space-y-1">
            <Label htmlFor={service}>{label}</Label>
            <p className="text-xs text-muted-foreground">{help} {saved[service] ? `Saved: ${saved[service]}` : "Using main key."}</p>
            <div className="flex gap-2">
              <Input id={service} type="password" placeholder="AQ..." value={drafts[service] || ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [service]: e.target.value }))} />
              <Button onClick={() => save(service)} disabled={busy === service || !(drafts[service] || "").trim()}>
                <Save className="h-4 w-4" />
              </Button>
              {saved[service] && (
                <Button variant="outline" onClick={() => remove(service)} disabled={busy === service} aria-label={`Remove ${label} key`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [supadataKey, setSupadataKey] = useState("");
  const [supadataLabel, setSupadataLabel] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  type TranscriptKey = { id: string; label: string; masked: string; updatedAt: string };
  const [transcriptKeys, setTranscriptKeys] = useState<TranscriptKey[]>([]);

  // ─── Bring-your-own AI provider key ───
  const [aiProvider, setAiProvider] = useState<string>("gemini");
  const [geminiModel, setGeminiModel] = useState<string>(() => getSelectedGeminiModel());
  const [aiKey, setAiKey] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [activeAi, setActiveAi] = useState<{ provider: string; masked: string } | null>(null);
  type BrainAccessKey = { id: string; name: string; key_prefix: string; scopes: string[]; expires_at: string; revoked_at: string | null; total_requests: number };
  const [brainKeys, setBrainKeys] = useState<BrainAccessKey[]>([]);
  const [newBrainKeyName, setNewBrainKeyName] = useState("");
  const [allowBrainGenerate, setAllowBrainGenerate] = useState(false);
  const [newBrainSecret, setNewBrainSecret] = useState("");
  const [brainKeyBusy, setBrainKeyBusy] = useState(false);

  const loadBrainKeys = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("manage-sales-brain-access", { body: { action: "list" } });
    if (error || data?.error) throw new Error(data?.error || "Could not load Sales Brain API keys");
    setBrainKeys(data.keys || []);
  }, []);

  useEffect(() => {
    if (user) loadBrainKeys().catch(() => {});
  }, [user, loadBrainKeys]);

  const createBrainKey = async () => {
    if (!newBrainKeyName.trim()) { toast.error("Name this integration first"); return; }
    setBrainKeyBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-sales-brain-access", {
        body: { action: "create", name: newBrainKeyName.trim(), scopes: allowBrainGenerate ? ["context", "generate"] : ["context"] },
      });
      if (error || data?.error) throw new Error(data?.error || "Could not create key");
      setNewBrainSecret(data.key);
      setNewBrainKeyName("");
      await loadBrainKeys();
      toast.success("Sales Brain API key created. Copy it now; it will not be shown again.");
    } catch (error: any) { toast.error(error.message || "Could not create key"); }
    finally { setBrainKeyBusy(false); }
  };

  const revokeBrainKey = async (id: string) => {
    setBrainKeyBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-sales-brain-access", { body: { action: "revoke", id } });
      if (error || data?.error) throw new Error(data?.error || "Could not revoke key");
      await loadBrainKeys();
      toast.success("Sales Brain API key revoked");
    } catch (error: any) { toast.error(error.message || "Could not revoke key"); }
    finally { setBrainKeyBusy(false); }
  };

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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Key className="h-5 w-5" />External Sales Brain API</CardTitle>
            <CardDescription>
              Let another website use your uploaded books, PDFs, and video knowledge. The context API analyzes the supplied conversation and returns relevant principles and source excerpts before that site's AI writes. Optional generation uses your configured AI provider and its quota.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">Use these keys only on the other website's server, never in browser JavaScript. Keys expire after 90 days and are limited to 30 requests per minute.</p>
            {newBrainSecret && (
              <Alert><AlertDescription className="space-y-2">
                <strong>Copy this new key now — it will not be shown again.</strong>
                <div className="flex gap-2 items-center"><code className="block min-w-0 flex-1 break-all text-xs">{newBrainSecret}</code>
                  <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(newBrainSecret).then(() => toast.success("Copied"))}>Copy</Button>
                </div>
              </AlertDescription></Alert>
            )}
            {brainKeys.filter((key) => !key.revoked_at).map((key) => (
              <div key={key.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium truncate">{key.name}</div>
                  <div className="text-xs text-muted-foreground"><code>{key.key_prefix}…</code> · {key.scopes.join(", ")} · {key.total_requests} calls · expires {new Date(key.expires_at).toLocaleDateString()}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => revokeBrainKey(key.id)} disabled={brainKeyBusy}>Revoke</Button>
              </div>
            ))}
            <div className="space-y-2"><Label htmlFor="brain-key-name">Integration name</Label>
              <Input id="brain-key-name" value={newBrainKeyName} onChange={(event) => setNewBrainKeyName(event.target.value)} maxLength={80} placeholder="e.g. My other website" />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowBrainGenerate} onChange={(event) => setAllowBrainGenerate(event.target.checked)} /> Allow this key to generate answers with my AI provider</label>
            <Button onClick={createBrainKey} disabled={brainKeyBusy || !newBrainKeyName.trim()}><Plus className="mr-2 h-4 w-4" />Create Sales Brain API key</Button>
            <p className="text-xs text-muted-foreground">Endpoint: <code className="break-all">https://iyqwrgqyfsfqgqqhlbec.supabase.co/functions/v1/sales-brain-api</code>. See the integration guide in the repository for a server-side example.</p>
          </CardContent>
        </Card>

        {/* Bring-your-own AI provider */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bot className="h-5 w-5" />
              AI Provider
            </CardTitle>
            <CardDescription>
              Configure your Google Gemini, OpenAI, or Anthropic API key to power all AI sales coaching, conversations, and intelligence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
              <div className="text-sm">
                <span className="text-muted-foreground">Active Model Engine: </span>
                {activeAi ? (
                  <>
                    <span className="font-medium">{AI_PROVIDERS.find((p) => p.value === activeAi.provider)?.label.split(" (")[0]}</span>
                    <code className="ml-2 bg-muted px-2 py-0.5 rounded text-xs">{activeAi.masked}</code>
                    <code className="ml-2 bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-medium">
                      {activeAi.provider === "gemini" ? geminiModel : PROVIDER_MODEL[activeAi.provider as ActiveAi["provider"]]?.model}
                    </code>
                  </>
                ) : (
                  <>
                    <span className="font-medium">Google Gemini</span>
                    <code className="ml-2 bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-medium">
                      {geminiModel}
                    </code>
                  </>
                )}
              </div>
              {activeAi && (
                <Button variant="ghost" size="sm" onClick={handleRemoveAiKey} disabled={aiSaving}>
                  Remove Key
                </Button>
              )}
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

            {aiProvider === "gemini" && (
              <div className="space-y-2">
                <Label>AI Model Engine</Label>
                <Select
                  value={geminiModel}
                  onValueChange={(val) => {
                    setGeminiModel(val);
                    setSelectedGeminiModel(val);
                    toast.success(`AI Model Engine switched to ${val}`);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GEMINI_AVAILABLE_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Used by AI Chat. If 3.8 is busy, switch to 3.7 here. Friend replies always use Gemini 3.7 Flash.</p>
              </div>
            )}

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

        {aiProvider === "gemini" && <GeminiStepKeys />}

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
