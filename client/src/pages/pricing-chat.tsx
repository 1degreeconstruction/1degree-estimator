import { useState, useRef, useEffect } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { Send, Bot, User, AlertTriangle, CheckCircle, X } from "lucide-react";

const BACKEND_URL = import.meta.env.PROD
  ? "https://onedegree-estimator.onrender.com"
  : "";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ProposedChange {
  trade: string;
  scopeKeyword: string;
  subCost: number;
  city: string;
  reason: string;
}

interface AssistantMessage extends Message {
  proposedChange?: ProposedChange;
}

type ChatMessage = Message | AssistantMessage;

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mb-4">
      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
        <Bot className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="bg-card border rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex gap-1 items-center h-5">
          <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

function ProposedChangeCard({
  change,
  onConfirm,
  onCancel,
  confirming,
}: {
  change: ProposedChange;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}) {
  const [showDialog, setShowDialog] = useState(false);

  const handleConfirmClick = () => {
    setShowDialog(true);
  };

  const handleFinalConfirm = () => {
    setShowDialog(false);
    onConfirm();
  };

  return (
    <>
      <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
        <div className="flex items-center gap-2 text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="text-sm font-semibold">Proposed Pricing Update</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Trade</p>
            <p className="font-medium">{change.trade}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Scope Keyword</p>
            <p className="font-medium">{change.scopeKeyword}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">New Sub Cost</p>
            <p className="font-semibold text-green-400">${change.subCost.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">City</p>
            <p className="font-medium">{change.city || "—"}</p>
          </div>
        </div>
        {change.reason && (
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Reason</p>
            <p className="text-sm text-muted-foreground">{change.reason}</p>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="border-amber-500/50 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300"
            onClick={handleConfirmClick}
            disabled={confirming}
          >
            <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
            Confirm Update
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={onCancel}
            disabled={confirming}
          >
            <X className="w-3.5 h-3.5 mr-1.5" />
            Cancel
          </Button>
        </div>
      </div>

      {/* Second confirmation dialog */}
      {showDialog && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-base">Confirm Pricing Update</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Are you sure you want to update{" "}
                  <span className="text-foreground font-medium">{change.trade}</span> pricing to{" "}
                  <span className="text-green-400 font-semibold">${change.subCost.toLocaleString()}</span>{" "}
                  {change.city ? (
                    <>
                      for <span className="text-foreground font-medium">{change.city}</span>
                    </>
                  ) : null}
                  ? This will affect future AI-generated estimates.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-amber-500 hover:bg-amber-400 text-black"
                onClick={handleFinalConfirm}
              >
                Yes, Update Pricing
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function PricingChat() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [dismissedChanges, setDismissedChanges] = useState<Set<number>>(new Set());
  const [confirmingIndexes, setConfirmingIndexes] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const canUpdate = user?.role === "admin" || user?.role === "estimator";

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/pricing-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          message: text,
          conversationHistory: messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Request failed");
      }

      const data = await res.json();
      const assistantMsg: AssistantMessage = {
        role: "assistant",
        content: data.reply,
        proposedChange: data.proposedChange,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to get response",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleConfirmUpdate = async (index: number, change: ProposedChange) => {
    setConfirmingIndexes((prev) => new Set(prev).add(index));
    try {
      const res = await fetch(`${BACKEND_URL}/api/pricing-history/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify(change),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Update failed" }));
        throw new Error(err.error || "Update failed");
      }

      toast({
        title: "Pricing Updated",
        description: `${change.trade} / ${change.scopeKeyword} set to $${change.subCost.toLocaleString()}${change.city ? ` (${change.city})` : ""}`,
      });
      setDismissedChanges((prev) => new Set(prev).add(index));
    } catch (err: any) {
      toast({
        title: "Update Failed",
        description: err.message || "Could not update pricing",
        variant: "destructive",
      });
    } finally {
      setConfirmingIndexes((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  const handleCancelChange = (index: number) => {
    setDismissedChanges((prev) => new Set(prev).add(index));
  };

  const emptyState = messages.length === 0;

  return (
    <AdminLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="border-b px-6 py-4 shrink-0">
          <h1 className="text-lg font-semibold font-display">Pricing Assistant</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ask about historical pricing, compare costs across projects, or update the pricing database.
          </p>
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
          {emptyState && (
            <div className="flex flex-col items-center justify-center h-full text-center py-16 max-w-sm mx-auto">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Bot className="w-7 h-7 text-primary" />
              </div>
              <h2 className="text-base font-semibold mb-2">Pricing Assistant</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Ask me about historical costs, trade pricing trends, or how to price a scope of work.
              </p>
              <div className="grid gap-2 w-full text-left">
                {[
                  "What did we pay for framing on the last 5 projects?",
                  "Compare electrical costs across cities",
                  "What's the average demo cost per project?",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setInput(suggestion);
                      inputRef.current?.focus();
                    }}
                    className="text-sm text-left px-4 py-2.5 rounded-xl border bg-card hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            const isUser = msg.role === "user";
            const assistantMsg = msg as AssistantMessage;
            const hasChange = !isUser && assistantMsg.proposedChange && !dismissedChanges.has(i);

            return (
              <div key={i} className={`flex items-end gap-2 mb-4 ${isUser ? "flex-row-reverse" : ""}`}>
                {/* Avatar */}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    isUser ? "bg-primary" : "bg-muted"
                  }`}
                >
                  {isUser ? (
                    <User className="w-4 h-4 text-primary-foreground" />
                  ) : (
                    <Bot className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>

                {/* Bubble */}
                <div className={`max-w-[80%] md:max-w-[65%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
                  <div
                    className={`px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
                      isUser
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-card border rounded-bl-sm"
                    }`}
                  >
                    {msg.content}
                  </div>

                  {/* Proposed change card */}
                  {hasChange && canUpdate && (
                    <ProposedChangeCard
                      change={assistantMsg.proposedChange!}
                      onConfirm={() => handleConfirmUpdate(i, assistantMsg.proposedChange!)}
                      onCancel={() => handleCancelChange(i)}
                      confirming={confirmingIndexes.has(i)}
                    />
                  )}
                  {hasChange && !canUpdate && (
                    <div className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                      Pricing update requires admin or estimator role.
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isLoading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t px-4 py-4 shrink-0 bg-background">
          <div className="flex gap-2 items-end max-w-3xl mx-auto">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about pricing, costs, or trends… (Enter to send, Shift+Enter for new line)"
              className="resize-none min-h-[44px] max-h-[160px] text-sm py-3"
              rows={1}
              disabled={isLoading}
            />
            <Button
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Responses are based on your historical pricing data and project records.
          </p>
        </div>
      </div>
    </AdminLayout>
  );
}
