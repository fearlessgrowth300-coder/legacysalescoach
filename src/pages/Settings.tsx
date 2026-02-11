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

  // Load saved key from user profile metadata
  useEffect(() => {
    if (user) {
      const meta = (user as any)?.user_metadata;
      if (meta?.supadata_api_key) {
        const key = meta.supadata_api_key;
        setCurrentKeyMasked(key.substring(0, 8) + "..." + key.substring(key.length - 4));
      }
    }
  }, [user]);

  const handleSaveKey = async () => {
    if (!supadataKey.trim()) {
      toast.error("Please enter an API key");
      return;
    }
    setIsSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { supadata_api_key: supadataKey.trim() },
      });
      if (error) throw error;
      setCurrentKeyMasked(supadataKey.substring(0, 8) + "..." + supadataKey.substring(supadataKey.length - 4));
      setSupadataKey("");
      toast.success("API key saved successfully!");
    } catch (error: any) {
      toast.error(error.message || "Failed to save API key");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="container py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-primary" />
          Settings
        </h1>
        <p className="text-muted-foreground">Manage your app configuration and API keys</p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Key className="h-5 w-5" />
              YouTube Transcript API Key
            </CardTitle>
            <CardDescription>
              Used for extracting YouTube video transcripts automatically. You get 100 free credits.
              When credits run out, the app will ask you to paste transcripts manually or add a new key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Get your API key from{" "}
                <a href="https://supadata.ai" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  supadata.ai
                </a>
                . Free tier includes 100 credits. Each transcript uses 1-2 credits.
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
