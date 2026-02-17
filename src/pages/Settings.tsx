import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Settings as SettingsIcon, Key, Save, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export default function Settings() {
  const { user } = useAuth();
  const [supadataKey, setSupadataKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [currentKeyMasked, setCurrentKeyMasked] = useState("");

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
                . Sign up for free to get started. Your key is stored securely on the server and never sent back to the browser.
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
