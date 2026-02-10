import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";
import {
  MessageSquare, Plus, Send, Image, User, Sparkles,
  ThumbsUp, ThumbsDown, Copy, Check, AlertTriangle,
  Heart, Briefcase, MoreVertical, Trash2, Target, Upload
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type Suggestion = { id: number; type: string; text: string; whyThisWorks?: string };

export default function Chats() {
  const { prospectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const selectedProspectId = prospectId || null;

  const [newProspectOpen, setNewProspectOpen] = useState(false);
  const [newProspectName, setNewProspectName] = useState("");
  const [newProspectIg, setNewProspectIg] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [inputMode, setInputMode] = useState<"text" | "screenshot">("text");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [pushyWarning, setPushyWarning] = useState<string | null>(null);
  const [currentThreadType, setCurrentThreadType] = useState<"friend" | "expert">("friend");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Get active workspace
  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspaces").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
  const activeWorkspace = workspaces?.find((w) => w.is_active);

  // Get prospects
  const { data: prospects } = useQuery({
    queryKey: ["prospects", activeWorkspace?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospects")
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!activeWorkspace?.id,
  });

  // Get messages for selected prospect
  const { data: messages } = useQuery({
    queryKey: ["messages", selectedProspectId, currentThreadType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("prospect_id", selectedProspectId!)
        .eq("thread_type", currentThreadType)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedProspectId,
  });

  const selectedProspect = prospects?.find((p) => p.id === selectedProspectId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const createProspect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("prospects")
        .insert({
          user_id: user!.id,
          workspace_id: activeWorkspace!.id,
          name: newProspectName,
          instagram_url: newProspectIg || null,
          reply_mode: activeWorkspace!.default_reply_mode,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("New chat created!");
      setNewProspectOpen(false);
      setNewProspectName("");
      setNewProspectIg("");
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      navigate(`/chats/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSendInbound = async () => {
    if (!messageInput.trim() || !selectedProspectId) return;
    setIsAnalyzing(true);

    // Save the inbound message
    await supabase.from("chat_messages").insert({
      user_id: user!.id,
      prospect_id: selectedProspectId,
      content: messageInput,
      direction: "inbound",
      thread_type: currentThreadType,
    });

    // Get AI suggestions via edge function
    try {
      const { data, error } = await supabase.functions.invoke("chat-suggest", {
        body: {
          prospectId: selectedProspectId,
          message: messageInput,
          threadType: currentThreadType,
        },
      });
      if (error) throw error;
      setSuggestions(data.suggestions || []);
      setPushyWarning(data.pushyWarning || null);
    } catch (e: any) {
      console.error("AI suggestion error:", e);
      toast.error("Failed to get suggestions");
    }

    setMessageInput("");
    queryClient.invalidateQueries({ queryKey: ["messages"] });
    setIsAnalyzing(false);
  };

  const handleUseSuggestion = async (suggestion: Suggestion) => {
    if (!selectedProspectId) return;
    await supabase.from("chat_messages").insert({
      user_id: user!.id,
      prospect_id: selectedProspectId,
      content: suggestion.text,
      direction: "outbound",
      thread_type: currentThreadType,
      is_ai_suggestion: true,
    });
    setSuggestions([]);
    setPushyWarning(null);
    queryClient.invalidateQueries({ queryKey: ["messages"] });
    toast.success("Response recorded!");
  };

  const handleCopy = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Copied!");
  };

  const updateOutcome = useMutation({
    mutationFn: async ({ id, outcome }: { id: string; outcome: string }) => {
      const { error } = await supabase.from("prospects").update({ outcome }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["prospects"] }),
  });

  const deleteProspect = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("prospects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chat deleted");
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      navigate("/chats");
    },
  });

  if (!activeWorkspace) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <Card className="max-w-md">
          <CardHeader><CardTitle>Create a Workspace First</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">You need a workspace before you can start chatting with prospects.</p>
            <Button onClick={() => navigate("/workspaces")}>Go to Workspaces</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Sidebar - Prospect List */}
      <div className="w-80 border-r flex flex-col bg-muted/30">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Chats</h2>
            <Dialog open={newProspectOpen} onOpenChange={setNewProspectOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />New</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Chat</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label>Prospect Name *</Label>
                    <Input value={newProspectName} onChange={(e) => setNewProspectName(e.target.value)} placeholder="e.g., Sarah, John D." />
                  </div>
                  <div>
                    <Label>Instagram URL</Label>
                    <Input value={newProspectIg} onChange={(e) => setNewProspectIg(e.target.value)} placeholder="https://instagram.com/username" />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => createProspect.mutate()} disabled={!newProspectName.trim()}>Create Chat</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <p className="text-xs text-muted-foreground">Workspace: {activeWorkspace.name}</p>
        </div>

        <ScrollArea className="flex-1">
          {prospects?.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No chats yet</p>
              <p className="text-xs">Click "New" to start</p>
            </div>
          ) : (
            <div className="divide-y">
              {prospects?.map((prospect) => (
                <div
                  key={prospect.id}
                  className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${selectedProspectId === prospect.id ? "bg-muted" : ""}`}
                  onClick={() => navigate(`/chats/${prospect.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-medium truncate">{prospect.name}</p>
                        {prospect.reply_mode === "expert" ? <Briefcase className="h-3 w-3 text-blue-500" /> : <Heart className="h-3 w-3 text-pink-500" />}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{prospect.conversation_stage?.replace(/_/g, " ")}</p>
                    </div>
                    {prospect.outcome !== "active" && (
                      <Badge variant={prospect.outcome === "won" ? "default" : "secondary"} className="text-xs">{prospect.outcome}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {!selectedProspectId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="font-medium mb-1">Select a chat</h3>
              <p className="text-sm text-muted-foreground">Choose a prospect or create a new chat</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">{selectedProspect?.name}</h3>
                  <p className="text-xs text-muted-foreground">{selectedProspect?.detected_interests || "Paste a message to get AI suggestions"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={currentThreadType} onValueChange={(v: "friend" | "expert") => { setCurrentThreadType(v); setSuggestions([]); }}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friend"><div className="flex items-center gap-2"><Heart className="h-3 w-3 text-pink-500" />Friend</div></SelectItem>
                    <SelectItem value="expert"><div className="flex items-center gap-2"><Briefcase className="h-3 w-3 text-blue-500" />Expert</div></SelectItem>
                  </SelectContent>
                </Select>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { updateOutcome.mutate({ id: selectedProspectId!, outcome: "won" }); toast.success("Marked as won!"); }}>Mark as Won</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { updateOutcome.mutate({ id: selectedProspectId!, outcome: "lost" }); toast.success("Marked as lost"); }}>Mark as Lost</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { updateOutcome.mutate({ id: selectedProspectId!, outcome: "ghosted" }); toast.success("Marked as ghosted"); }}>Mark as Ghosted</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => deleteProspect.mutate(selectedProspectId!)}>
                      <Trash2 className="h-4 w-4 mr-2" />Delete Chat
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Thread Type Header */}
            <div className={`px-4 py-2 border-b ${currentThreadType === "expert" ? "bg-blue-50 dark:bg-blue-950/20" : "bg-pink-50 dark:bg-pink-950/20"}`}>
              <div className="flex items-center gap-2">
                {currentThreadType === "expert" ? (
                  <>
                    <Briefcase className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900 dark:text-blue-100">Expert Team Mode - Professional & Direct</span>
                  </>
                ) : (
                  <>
                    <Heart className="h-4 w-4 text-pink-600" />
                    <span className="text-sm font-medium text-pink-900 dark:text-pink-100">Friend Mode - Warm & Casual</span>
                  </>
                )}
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages?.map((message) => (
                  <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] rounded-lg p-3 ${message.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      {message.direction === "inbound" && message.detected_tone && (
                        <p className="text-xs mt-1 opacity-70">Tone: {message.detected_tone}</p>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* AI Suggestions */}
            {suggestions.length > 0 && (
              <div className="p-4 border-t bg-muted/30">
                {pushyWarning && (
                  <div className="flex items-center gap-2 text-amber-600 mb-3 text-sm">
                    <AlertTriangle className="h-4 w-4" /><span>{pushyWarning}</span>
                  </div>
                )}
                <p className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />Suggested Replies
                </p>
                <div className="space-y-2">
                  {suggestions.map((s) => (
                    <Card key={s.id} className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <Badge variant="outline" className="mb-2 text-xs">
                            {s.type === "primary" ? "Best Reply" : s.type === "alternative" ? "Alternative" : "Softer"}
                          </Badge>
                          <p className="text-sm">{s.text}</p>
                          {s.whyThisWorks && <p className="text-xs text-muted-foreground mt-2">💡 {s.whyThisWorks}</p>}
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleCopy(s.id, s.text)}>
                            {copiedId === s.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                          </Button>
                          <Button size="sm" onClick={() => handleUseSuggestion(s)}>Use</Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Input Area */}
            <div className="p-4 border-t">
              <div className="flex gap-2">
                <Textarea
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="Paste the prospect's message here..."
                  className="min-h-[80px]"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendInbound(); } }}
                />
                <Button onClick={handleSendInbound} disabled={!messageInput.trim() || isAnalyzing} className="self-end">
                  {isAnalyzing ? <Sparkles className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
