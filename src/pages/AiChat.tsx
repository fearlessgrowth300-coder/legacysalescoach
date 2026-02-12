import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Brain, Send, Loader2, BookOpen, Sparkles, Plus, MessageSquare,
  Image, Link, FileText, Pencil, Trash2, Check, X, Menu
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";

type Msg = { id?: string; role: "user" | "assistant"; content: string; image_url?: string | null; is_edited?: boolean };
type Conversation = { id: string; title: string; created_at: string; updated_at: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/brain-chat`;

async function streamChat({
  messages,
  onDelta,
  onDone,
  onError,
}: {
  messages: { role: string; content: string | any[] }[];
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) { onError("Not authenticated"); return; }

  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ messages }),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    onError(data.error || `Error ${resp.status}`);
    return;
  }
  if (!resp.body) { onError("No response body"); return; }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = false;

  while (!done) {
    const { done: rdone, value } = await reader.read();
    if (rdone) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") { done = true; break; }
      try {
        const parsed = JSON.parse(json);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch {
        buf = line + "\n" + buf;
        break;
      }
    }
  }
  onDone();
}

export default function AiChat() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [attachedImage, setAttachedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      const vp = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]");
      if (vp) vp.scrollTop = vp.scrollHeight;
    }, 50);
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  // Load conversations
  useEffect(() => {
    if (!user) return;
    loadConversations();
  }, [user]);

  const loadConversations = async () => {
    const { data } = await supabase
      .from("ai_conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data as Conversation[]);
  };

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    loadMessages(activeConvId);
  }, [activeConvId]);

  const loadMessages = async (convId: string) => {
    const { data } = await supabase
      .from("ai_chat_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (data) {
      setMessages(data.map((m: any) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        image_url: m.image_url,
        is_edited: m.is_edited,
      })));
    }
  };

  const createNewChat = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("ai_conversations")
      .insert({ user_id: user.id, title: "New Chat" })
      .select()
      .single();
    if (data) {
      setConversations(prev => [data as Conversation, ...prev]);
      setActiveConvId(data.id);
      setMessages([]);
    }
  };

  const deleteConversation = async (convId: string) => {
    await supabase.from("ai_conversations").delete().eq("id", convId);
    setConversations(prev => prev.filter(c => c.id !== convId));
    if (activeConvId === convId) {
      setActiveConvId(null);
      setMessages([]);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }
    setAttachedImage(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    if (!user) return null;
    const ext = file.name.split(".").pop();
    const path = `${user.id}/ai-chat/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("chat-screenshots").upload(path, file);
    if (error) { console.error("Upload error:", error); return null; }
    const { data: { publicUrl } } = supabase.storage.from("chat-screenshots").getPublicUrl(path);
    return publicUrl;
  };

  const feedLinkToBrain = async (url: string) => {
    if (!user) return;
    toast.info("Feeding link to AI Brain...");
    try {
      const { data: item } = await supabase
        .from("knowledge_base_items")
        .insert({
          user_id: user.id,
          title: `AI Chat Feed: ${url.substring(0, 50)}`,
          type: "url",
          url,
          status: "processing",
          brain_type: "both",
        })
        .select()
        .single();
      if (item) {
        await supabase.functions.invoke("process-knowledge", {
          body: { itemId: item.id, url, type: "url" },
        });
        toast.success("Link fed to AI Brain! Knowledge is being processed.");
      }
    } catch (e) {
      toast.error("Failed to feed link to brain");
    }
  };

  const send = async (overrideText?: string) => {
    const text = (overrideText || input).trim();
    if (!text && !attachedImage) return;
    if (isLoading) return;
    if (!user) return;

    // Create conversation if none active
    let convId = activeConvId;
    if (!convId) {
      const { data } = await supabase
        .from("ai_conversations")
        .insert({ user_id: user.id, title: text.substring(0, 50) || "New Chat" })
        .select()
        .single();
      if (!data) { toast.error("Failed to create conversation"); return; }
      convId = data.id;
      setActiveConvId(convId);
      setConversations(prev => [data as Conversation, ...prev]);
    }

    // Upload image if attached
    let imageUrl: string | null = null;
    if (attachedImage) {
      imageUrl = await uploadImage(attachedImage);
    }

    const userMsg: Msg = { role: "user", content: text || "Analyze this image", image_url: imageUrl };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setAttachedImage(null);
    setImagePreview(null);
    setIsLoading(true);

    // Save user message to DB
    const { data: savedMsg } = await supabase
      .from("ai_chat_messages")
      .insert({
        conversation_id: convId,
        user_id: user.id,
        role: "user",
        content: userMsg.content,
        image_url: imageUrl,
      })
      .select()
      .single();
    if (savedMsg) userMsg.id = savedMsg.id;

    // Update conversation title if it's the first message
    if (messages.length === 0 && text) {
      await supabase.from("ai_conversations").update({ title: text.substring(0, 60) }).eq("id", convId);
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: text.substring(0, 60) } : c));
    }

    // Build messages for AI - include image as multimodal content if present
    const aiMessages = [...messages, userMsg].map(m => {
      if (m.image_url && m.role === "user") {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            { type: "image_url", image_url: { url: m.image_url } },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    let assistantSoFar = "";
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      await streamChat({
        messages: aiMessages,
        onDelta: upsert,
        onDone: async () => {
          setIsLoading(false);
          // Save assistant message
          if (assistantSoFar && convId) {
            await supabase.from("ai_chat_messages").insert({
              conversation_id: convId,
              user_id: user!.id,
              role: "assistant",
              content: assistantSoFar,
            });
          }
        },
        onError: (err) => {
          toast.error(err);
          setIsLoading(false);
        },
      });
    } catch (e) {
      console.error(e);
      toast.error("Failed to get response");
      setIsLoading(false);
    }
  };

  const startEdit = (idx: number) => {
    if (messages[idx].role !== "user") return;
    setEditingMsgIdx(idx);
    setEditText(messages[idx].content);
  };

  const saveEdit = async () => {
    if (editingMsgIdx === null) return;
    const msg = messages[editingMsgIdx];

    // Update in DB
    if (msg.id) {
      await supabase.from("ai_chat_messages").update({ content: editText, is_edited: true }).eq("id", msg.id);
    }

    // Remove all messages after the edited one and resend
    const truncated = messages.slice(0, editingMsgIdx);
    truncated.push({ ...msg, content: editText, is_edited: true });

    // Delete subsequent DB messages
    if (activeConvId) {
      const idsToDelete = messages.slice(editingMsgIdx + 1).filter(m => m.id).map(m => m.id!);
      if (idsToDelete.length > 0) {
        await supabase.from("ai_chat_messages").delete().in("id", idsToDelete);
      }
    }

    setMessages(truncated);
    setEditingMsgIdx(null);
    setEditText("");

    // Resend with edited message
    setIsLoading(true);
    const aiMessages = truncated.map(m => {
      if (m.image_url && m.role === "user") {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            { type: "image_url", image_url: { url: m.image_url } },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    let assistantSoFar = "";
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      await streamChat({
        messages: aiMessages,
        onDelta: upsert,
        onDone: async () => {
          setIsLoading(false);
          if (assistantSoFar && activeConvId) {
            await supabase.from("ai_chat_messages").insert({
              conversation_id: activeConvId,
              user_id: user!.id,
              role: "assistant",
              content: assistantSoFar,
            });
          }
        },
        onError: (err) => { toast.error(err); setIsLoading(false); },
      });
    } catch {
      setIsLoading(false);
    }
  };

  const handleFeedLink = async () => {
    if (!linkInput.trim()) return;
    await feedLinkToBrain(linkInput.trim());
    // Also send as a message context
    setInput(`I just fed this link to my brain: ${linkInput.trim()} - Can you tell me what you know about this topic?`);
    setLinkInput("");
    setShowLinkInput(false);
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.name.endsWith(".pdf")) { toast.error("Only PDF files supported"); return; }
    if (file.size > 25 * 1024 * 1024) { toast.error("File must be under 25MB"); return; }

    toast.info("Uploading PDF to AI Brain...");
    const path = `${user.id}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from("knowledge-files").upload(path, file);
    if (uploadError) { toast.error("Upload failed"); return; }

    const { data: item } = await supabase
      .from("knowledge_base_items")
      .insert({
        user_id: user.id,
        title: `AI Chat: ${file.name}`,
        type: "pdf",
        file_path: path,
        status: "processing",
        brain_type: "both",
      })
      .select()
      .single();

    if (item) {
      await supabase.functions.invoke("process-knowledge", {
        body: { itemId: item.id, type: "pdf", filePath: path },
      });
      toast.success("PDF uploaded! Brain is learning from it...");
      setInput(`I just uploaded "${file.name}" to my brain. What can you help me with about it?`);
    }
    e.target.value = "";
  };

  const pdfInputRef = useRef<HTMLInputElement>(null);

  const starterQuestions = [
    "How should I handle price objections?",
    "What's the best opening message?",
    "How do I build rapport quickly?",
    "What closing techniques work best?",
  ];

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? "w-72" : "w-0"} transition-all duration-200 border-r bg-muted/30 flex flex-col overflow-hidden`}>
        <div className="p-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-sm">Chats</h3>
          <Button size="sm" variant="ghost" onClick={createNewChat}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.map(conv => (
              <div
                key={conv.id}
                className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-sm group transition-colors ${
                  activeConvId === conv.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
                }`}
                onClick={() => setActiveConvId(conv.id)}
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span className="truncate flex-1">{conv.title}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center p-4">No chats yet. Start a new one!</p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="p-3 border-b flex items-center gap-3">
          <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(!sidebarOpen)} className="shrink-0">
            <Menu className="h-4 w-4" />
          </Button>
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Brain className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-sm flex items-center gap-1 truncate">
              AI Brain Chat <Sparkles className="h-3 w-3 text-primary shrink-0" />
            </h2>
            <p className="text-xs text-muted-foreground truncate">Ask anything — powered by your Knowledge Base</p>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-3 max-w-3xl mx-auto">
            {messages.length === 0 && !activeConvId && (
              <div className="text-center py-12">
                <Brain className="h-14 w-14 mx-auto mb-3 text-primary/30" />
                <h3 className="text-lg font-medium mb-2">Your AI Brain is Ready</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                  Ask anything, upload screenshots, feed links & PDFs. I learn from everything in your Knowledge Base.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto">
                  {starterQuestions.map((q) => (
                    <Card key={q} className="p-3 cursor-pointer hover:border-primary transition-colors text-left"
                      onClick={() => setInput(q)}>
                      <p className="text-sm text-muted-foreground">{q}</p>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {messages.length === 0 && activeConvId && (
              <div className="text-center py-12">
                <Brain className="h-14 w-14 mx-auto mb-3 text-primary/30" />
                <p className="text-sm text-muted-foreground">Start this conversation — ask anything!</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg p-3 relative group ${
                  msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}>
                  {msg.image_url && (
                    <img src={msg.image_url} alt="Attached" className="rounded-md mb-2 max-h-48 object-cover" />
                  )}

                  {editingMsgIdx === i ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="bg-background text-foreground min-h-[60px]"
                        autoFocus
                      />
                      <div className="flex gap-1">
                        <Button size="sm" variant="secondary" onClick={saveEdit}>
                          <Check className="h-3 w-3 mr-1" /> Save & Resend
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingMsgIdx(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {msg.role === "assistant" ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      )}
                      {msg.is_edited && (
                        <span className="text-[10px] opacity-60 mt-1 block">edited</span>
                      )}
                      {msg.role === "user" && !isLoading && (
                        <button
                          onClick={() => startEdit(i)}
                          className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg p-3 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Thinking...</span>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Attachment Preview */}
        {imagePreview && (
          <div className="px-4 pb-1">
            <div className="relative inline-block">
              <img src={imagePreview} alt="Preview" className="h-16 rounded-md border" />
              <button onClick={() => { setAttachedImage(null); setImagePreview(null); }}
                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center text-xs">
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Link Input */}
        {showLinkInput && (
          <div className="px-4 pb-1">
            <div className="flex gap-2 items-center bg-muted rounded-lg p-2">
              <Link className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="Paste YouTube, Instagram, or any URL to feed to brain..."
                className="h-8 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") handleFeedLink(); }}
                autoFocus
              />
              <Button size="sm" onClick={handleFeedLink} disabled={!linkInput.trim()}>Feed</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowLinkInput(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="p-3 border-t max-w-3xl mx-auto w-full">
          <div className="flex gap-2 items-end">
            {/* Action buttons */}
            <div className="flex gap-1 pb-1">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => fileInputRef.current?.click()} title="Upload screenshot">
                <Image className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setShowLinkInput(!showLinkInput)} title="Feed link to brain">
                <Link className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => pdfInputRef.current?.click()} title="Upload PDF to brain">
                <FileText className="h-4 w-4" />
              </Button>
            </div>

            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask your AI Brain anything..."
              className="min-h-[50px] max-h-[150px] resize-none flex-1"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={isLoading}
            />
            <Button onClick={() => send()} disabled={(!input.trim() && !attachedImage) || isLoading} className="self-end">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <BookOpen className="h-3 w-3" /> Answers from your Knowledge Base • Upload screenshots, PDFs, or links to teach me more
          </p>
        </div>

        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
        <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfUpload} />
      </div>
    </div>
  );
}
