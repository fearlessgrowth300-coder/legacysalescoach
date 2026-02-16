import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Upload, FileText, Camera, Loader2, Trash2, CheckCircle2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Props {
  workspaceId: string;
  userId: string;
}

export default function WorkspaceTrainingUpload({ workspaceId, userId }: Props) {
  const queryClient = useQueryClient();
  const [pasteContent, setPasteContent] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const { data: trainingData } = useQuery({
    queryKey: ["workspace-training", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_training_data" as any)
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const uploadAndAnalyze = async (content: string, title: string, type: string, filePath?: string) => {
    setAnalyzing(true);
    try {
      // Insert training data record
      const { data: inserted, error: insertError } = await supabase
        .from("workspace_training_data" as any)
        .insert({
          workspace_id: workspaceId,
          user_id: userId,
          title,
          type,
          content: content.substring(0, 50000),
          file_path: filePath || null,
          status: "processing",
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Call analyze-training-data edge function
      const { error: fnError } = await supabase.functions.invoke("analyze-training-data", {
        body: {
          workspaceId,
          trainingDataId: (inserted as any).id,
          content: content.substring(0, 20000),
          title,
          type,
        },
      });

      if (fnError) throw fnError;

      toast.success("Style fingerprint extracted & saved!");
      queryClient.invalidateQueries({ queryKey: ["workspace-training", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setPasteContent("");
      setPasteTitle("");
    } catch (e: any) {
      toast.error(e.message || "Failed to analyze training data");
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePasteSubmit = () => {
    if (!pasteContent.trim()) return;
    uploadAndAnalyze(
      pasteContent,
      pasteTitle || "Pasted Conversation",
      "text"
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: "pdf" | "txt") => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === "pdf") {
      // Upload to storage, then use OCR
      const filePath = `training/${userId}/${workspaceId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("knowledge-files")
        .upload(filePath, file);

      if (uploadError) {
        toast.error("Upload failed: " + uploadError.message);
        return;
      }

      // Use OCR to extract text
      setAnalyzing(true);
      try {
        // Read file as base64 for OCR
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const { data: ocrData, error: ocrError } = await supabase.functions.invoke("ocr-screenshot", {
            body: { imageBase64: base64, mimeType: file.type },
          });

          if (ocrError || !ocrData?.text) {
            toast.error("Could not extract text from PDF");
            setAnalyzing(false);
            return;
          }

          await uploadAndAnalyze(ocrData.text, file.name, "pdf", filePath);
        };
        reader.readAsDataURL(file);
      } catch {
        setAnalyzing(false);
      }
    } else {
      // TXT file - read directly
      const text = await file.text();
      await uploadAndAnalyze(text, file.name, "text");
    }
    e.target.value = "";
  };

  const handleScreenshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalyzing(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const { data: ocrData, error: ocrError } = await supabase.functions.invoke("ocr-screenshot", {
          body: { imageBase64: base64, mimeType: file.type },
        });

        if (ocrError || !ocrData?.text) {
          toast.error("Could not extract text from screenshot");
          setAnalyzing(false);
          return;
        }

        await uploadAndAnalyze(ocrData.text, `Screenshot: ${file.name}`, "screenshot");
      };
      reader.readAsDataURL(file);
    } catch {
      setAnalyzing(false);
    }
    e.target.value = "";
  };

  const deleteTraining = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workspace_training_data" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Training data removed");
      queryClient.invalidateQueries({ queryKey: ["workspace-training", workspaceId] });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-semibold flex items-center gap-2">
          <Upload className="h-4 w-4" /> Conversation Training Memory
        </Label>
        <p className="text-xs text-muted-foreground mb-3">
          Upload past conversations, PDFs, or screenshots. The AI will extract your style fingerprint and match it in every reply.
        </p>
      </div>

      {/* Paste Section */}
      <div className="space-y-2">
        <Input
          value={pasteTitle}
          onChange={(e) => setPasteTitle(e.target.value)}
          placeholder="Title (e.g., 'Winning DM with Sarah')"
          className="text-sm"
        />
        <Textarea
          value={pasteContent}
          onChange={(e) => setPasteContent(e.target.value)}
          placeholder="Paste conversation logs here...&#10;&#10;You: Hey! I saw your post about...&#10;Them: Thanks! Yeah I've been struggling with...&#10;You: I totally get that, I was in the same spot..."
          rows={5}
          className="text-sm"
        />
        <Button
          size="sm"
          onClick={handlePasteSubmit}
          disabled={!pasteContent.trim() || analyzing}
        >
          {analyzing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
          Analyze Conversation
        </Button>
      </div>

      {/* Upload Buttons */}
      <div className="flex flex-wrap gap-2">
        <label>
          <input type="file" accept=".pdf" className="hidden" onChange={(e) => handleFileUpload(e, "pdf")} disabled={analyzing} />
          <Button size="sm" variant="outline" asChild disabled={analyzing}>
            <span className="cursor-pointer"><FileText className="h-4 w-4 mr-1" /> Upload PDF</span>
          </Button>
        </label>
        <label>
          <input type="file" accept=".txt,.md,.csv" className="hidden" onChange={(e) => handleFileUpload(e, "txt")} disabled={analyzing} />
          <Button size="sm" variant="outline" asChild disabled={analyzing}>
            <span className="cursor-pointer"><FileText className="h-4 w-4 mr-1" /> Upload TXT</span>
          </Button>
        </label>
        <label>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleScreenshot(e)} disabled={analyzing} />
          <Button size="sm" variant="outline" asChild disabled={analyzing}>
            <span className="cursor-pointer"><Camera className="h-4 w-4 mr-1" /> OCR Screenshot</span>
          </Button>
        </label>
      </div>

      {/* Existing Training Data */}
      {trainingData && trainingData.length > 0 && (
        <div className="space-y-2 mt-3">
          <p className="text-xs font-medium text-muted-foreground">Training Data ({trainingData.length})</p>
          {trainingData.map((td: any) => (
            <Card key={td.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{td.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">{td.type}</Badge>
                    <Badge
                      variant={td.status === "ready" ? "default" : td.status === "error" ? "destructive" : "secondary"}
                      className="text-xs"
                    >
                      {td.status === "ready" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                      {td.status === "processing" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                      {td.status}
                    </Badge>
                  </div>
                  {td.style_analysis?.overall_personality && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      Style: {td.style_analysis.overall_personality}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => deleteTraining.mutate(td.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
