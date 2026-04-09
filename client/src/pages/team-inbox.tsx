import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "@/components/admin-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Mail, MailOpen, RefreshCw, Send, ExternalLink,
  Wifi, WifiOff, CheckCircle, Eye, FileText, MessageSquare,
} from "lucide-react";

interface EmailEntry {
  id: number;
  estimateId: number | null;
  fromEmail: string | null;
  fromName: string | null;
  subject: string;
  bodyPreview: string | null;
  bodyHtml: string | null;
  direction: string;
  emailType: string;
  isRead: boolean;
  sentAt: string;
  recipientEmail: string;
  gmailThreadId: string | null;
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  estimate:               { icon: <FileText className="w-3.5 h-3.5" />, color: "text-blue-400" },
  follow_up_1:            { icon: <Send className="w-3.5 h-3.5" />, color: "text-purple-400" },
  follow_up_2:            { icon: <Send className="w-3.5 h-3.5" />, color: "text-purple-400" },
  client_reply:           { icon: <MessageSquare className="w-3.5 h-3.5" />, color: "text-green-400" },
  internal_notification:  { icon: <CheckCircle className="w-3.5 h-3.5" />, color: "text-amber-400" },
};

function timeSince(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function TeamInbox() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<EmailEntry | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);

  const { data, isLoading } = useQuery<{ emails: EmailEntry[]; unreadCount: number }>({
    queryKey: ["/api/inbox"],
    refetchInterval: 60000, // auto-refresh every 60s
  });

  const { data: status } = useQuery<{ connected: boolean; connectedAs: string | null; unreadCount: number }>({
    queryKey: ["/api/inbox/status"],
  });

  const pollMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/inbox/poll"),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: `Pulled ${data.polled} messages, ${data.saved} new` });
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
    onError: (e: any) => toast({ title: "Poll failed", description: e.message, variant: "destructive" }),
  });

  const connectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/inbox/connect-team-gmail"),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: `Team inbox connected as ${data.connectedAs}` });
      qc.invalidateQueries({ queryKey: ["/api/inbox/status"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const readMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/inbox/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/inbox"] }),
  });

  const replyMutation = useMutation({
    mutationFn: ({ estimateId, message, threadId }: { estimateId: number; message: string; threadId?: string }) =>
      apiRequest("POST", `/api/estimates/${estimateId}/reply`, { message, threadId }),
    onSuccess: () => {
      toast({ title: "Reply sent" });
      setReplyText("");
      setReplyOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
    onError: (e: any) => toast({ title: "Failed to send", description: e.message, variant: "destructive" }),
  });

  const handleSelect = (email: EmailEntry) => {
    setSelected(email);
    setReplyOpen(false);
    setReplyText("");
    if (!email.isRead) readMutation.mutate(email.id);
  };

  const emails = data?.emails ?? [];
  const unread = data?.unreadCount ?? 0;

  return (
    <AdminLayout>
      <div className="flex h-[calc(100vh-60px)]">
        {/* Left panel — list */}
        <div className="w-96 border-r border-zinc-800 flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-zinc-400" />
              <span className="font-semibold text-sm">Team Inbox</span>
              {unread > 0 && (
                <Badge className="bg-orange-500/20 text-orange-400 border-0 text-xs px-1.5">{unread}</Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {/* Team Gmail connection status */}
              {status?.connected ? (
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <Wifi className="w-3 h-3" />
                  <span className="hidden sm:inline">{status.connectedAs}</span>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                >
                  <WifiOff className="w-3 h-3 mr-1" />
                  Connect inbox
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => pollMutation.mutate()}
                disabled={pollMutation.isPending || !status?.connected}
                title="Check for new replies"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${pollMutation.isPending ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Email list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-sm text-zinc-500">Loading...</div>
            ) : emails.length === 0 ? (
              <div className="p-6 text-sm text-zinc-500 text-center">
                No messages yet.<br />
                Send your first estimate to a client to get started.
              </div>
            ) : (
              emails.map(email => {
                const cfg = TYPE_CONFIG[email.emailType] || TYPE_CONFIG.estimate;
                const isInbound = email.direction === "inbound";
                const isActive = selected?.id === email.id;
                return (
                  <button
                    key={email.id}
                    onClick={() => handleSelect(email)}
                    className={`w-full text-left px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/40 transition-colors ${
                      isActive ? "bg-zinc-800/60" : ""
                    } ${!email.isRead && isInbound ? "border-l-2 border-l-orange-500" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      {/* Direction icon */}
                      <div className={`mt-0.5 flex-shrink-0 ${cfg.color}`}>{cfg.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className={`text-xs font-medium truncate ${!email.isRead && isInbound ? "text-white" : "text-zinc-300"}`}>
                            {isInbound ? (email.fromName || email.fromEmail || "Client") : `To: ${email.recipientEmail}`}
                          </span>
                          <span className="text-[10px] text-zinc-600 flex-shrink-0">{timeSince(email.sentAt)}</span>
                        </div>
                        <div className={`text-xs truncate mb-0.5 ${!email.isRead && isInbound ? "text-zinc-200 font-medium" : "text-zinc-400"}`}>
                          {email.subject}
                        </div>
                        {email.bodyPreview && (
                          <div className="text-[11px] text-zinc-600 truncate">{email.bodyPreview}</div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel — detail */}
        <div className="flex-1 flex flex-col">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-zinc-600">
                <MailOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Select a message</p>
              </div>
            </div>
          ) : (
            <>
              {/* Message header */}
              <div className="px-6 py-4 border-b border-zinc-800">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-white mb-1">{selected.subject}</h2>
                    <p className="text-xs text-zinc-500">
                      {selected.direction === "inbound"
                        ? `From: ${selected.fromName || selected.fromEmail}`
                        : `To: ${selected.recipientEmail}`}
                      {" · "}{new Date(selected.sentAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {selected.estimateId && (
                      <Link href={`/estimates/${selected.estimateId}`}>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                          <ExternalLink className="w-3 h-3" />
                          Estimate
                        </Button>
                      </Link>
                    )}
                    {selected.estimateId && (
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-orange-600 hover:bg-orange-700"
                        onClick={() => setReplyOpen(r => !r)}
                      >
                        <Send className="w-3 h-3 mr-1" />
                        Reply
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Reply composer */}
              {replyOpen && selected.estimateId && (
                <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900/50">
                  <Textarea
                    placeholder="Type your reply..."
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    className="mb-2 min-h-[80px] text-sm"
                    data-testid="input-reply-text"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="bg-orange-600 hover:bg-orange-700"
                      disabled={!replyText.trim() || replyMutation.isPending}
                      onClick={() => replyMutation.mutate({
                        estimateId: selected.estimateId!,
                        message: replyText,
                        threadId: selected.gmailThreadId || undefined,
                      })}
                      data-testid="button-send-reply"
                    >
                      {replyMutation.isPending ? "Sending..." : "Send Reply"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)}>Cancel</Button>
                    <span className="text-xs text-zinc-500 ml-auto">Sends from your Gmail account</span>
                  </div>
                </div>
              )}

              {/* Message body */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {selected.bodyHtml ? (
                  <div
                    className="prose prose-sm prose-invert max-w-none text-zinc-300"
                    dangerouslySetInnerHTML={{ __html: selected.bodyHtml }}
                  />
                ) : (
                  <p className="text-sm text-zinc-400 whitespace-pre-wrap">{selected.bodyPreview || "(no content)"}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
