import { useState, useMemo } from "react";
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
  Wifi, WifiOff, CheckCircle, Eye, FileText, MessageSquare, ChevronRight, ChevronDown,
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

interface EstimateGroup {
  estimateId: number | null;
  label: string;
  estNumber: string;
  latestDate: string;
  emails: EmailEntry[];
  unreadCount: number;
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  estimate:               { icon: <FileText className="w-3 h-3" />, color: "text-blue-400", label: "Estimate Sent" },
  follow_up_1:            { icon: <Send className="w-3 h-3" />, color: "text-purple-400", label: "Follow-up" },
  follow_up_2:            { icon: <Send className="w-3 h-3" />, color: "text-purple-400", label: "Follow-up" },
  client_reply:           { icon: <MessageSquare className="w-3 h-3" />, color: "text-green-400", label: "Client Reply" },
  internal_notification:  { icon: <Eye className="w-3 h-3" />, color: "text-amber-400", label: "Notification" },
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
  const [expandedGroup, setExpandedGroup] = useState<number | null | "unlinked">(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailEntry | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);

  const { data, isLoading } = useQuery<{ emails: EmailEntry[]; unreadCount: number }>({
    queryKey: ["/api/inbox"],
    refetchInterval: 60000,
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

  const emails = data?.emails ?? [];
  const unread = data?.unreadCount ?? 0;

  // Group emails by estimateId, sorted by most recent activity
  const groups: EstimateGroup[] = useMemo(() => {
    const map = new Map<number | "unlinked", EmailEntry[]>();
    for (const email of emails) {
      const key = email.estimateId ?? "unlinked";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(email);
    }

    const result: EstimateGroup[] = [];
    for (const [key, groupEmails] of map) {
      // Sort emails within group by date desc
      groupEmails.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
      const latest = groupEmails[0];

      // Extract client name and estimate number separately
      let clientName = "Unlinked";
      let estNumber = "";
      if (key !== "unlinked") {
        const estMatch = latest.subject.match(/([A-Z0-9]+-[A-Z]+-\d{8}-\d+)/i);
        estNumber = estMatch ? estMatch[1] : `#${key}`;
        const inboundClient = groupEmails.find(e => e.fromName && e.direction === "inbound" && e.emailType !== "internal_notification")?.fromName;
        const outboundTo = groupEmails.find(e => e.direction === "outbound")?.recipientEmail;
        clientName = inboundClient || outboundTo || `Estimate ${estNumber}`;
      }

      result.push({
        estimateId: key === "unlinked" ? null : key as number,
        label: clientName,
        estNumber,
        latestDate: latest.sentAt,
        emails: groupEmails,
        unreadCount: groupEmails.filter(e => !e.isRead && (e.direction === "inbound")).length,
      });
    }

    // Sort by most recent activity
    result.sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());
    return result;
  }, [emails]);

  const handleSelectEmail = (email: EmailEntry) => {
    setSelectedEmail(email);
    setReplyOpen(false);
    setReplyText("");
    if (!email.isRead) readMutation.mutate(email.id);
  };

  return (
    <AdminLayout>
      <div className="flex h-[calc(100vh-60px)]">
        {/* Left panel — grouped list */}
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
              {status?.connected ? (
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <Wifi className="w-3 h-3" />
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                  <WifiOff className="w-3 h-3 mr-1" /> Connect
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => pollMutation.mutate()} disabled={pollMutation.isPending || !status?.connected}>
                <RefreshCw className={`w-3.5 h-3.5 ${pollMutation.isPending ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Grouped email list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-sm text-zinc-500">Loading...</div>
            ) : groups.length === 0 ? (
              <div className="p-6 text-sm text-zinc-500 text-center">
                No messages yet.<br />Send your first estimate to get started.
              </div>
            ) : (
              groups.map(group => {
                const key = group.estimateId ?? "unlinked";
                const isExpanded = expandedGroup === key;
                const latestEmail = group.emails[0];
                const latestType = TYPE_CONFIG[latestEmail.emailType] || TYPE_CONFIG.estimate;

                return (
                  <div key={String(key)}>
                    {/* Group header */}
                    <button
                      onClick={() => setExpandedGroup(isExpanded ? null : key)}
                      className={`w-full text-left px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/40 transition-colors ${
                        isExpanded ? "bg-zinc-800/50" : ""
                      } ${group.unreadCount > 0 ? "border-l-2 border-l-orange-500" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          {isExpanded ? <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" /> : <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />}
                          <div className="min-w-0">
                            <div className={`text-sm font-medium truncate ${group.unreadCount > 0 ? "text-white" : "text-zinc-300"}`}>
                              {group.label}
                            </div>
                            {group.estNumber && (
                              <div className="text-[11px] text-zinc-500 truncate">{group.estNumber}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          <div className="flex items-center gap-1.5">
                            {group.unreadCount > 0 && (
                              <Badge className="bg-orange-500 text-white border-0 text-[10px] px-1.5 py-0 h-4">{group.unreadCount}</Badge>
                            )}
                            <span className="text-[10px] text-zinc-600">{timeSince(group.latestDate)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className={`${latestType.color}`}>{latestType.icon}</span>
                            <span className="text-[10px] text-zinc-600">{group.emails.length}</span>
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* Expanded: individual emails */}
                    {isExpanded && (
                      <div className="bg-zinc-900/30">
                        {group.emails.map(email => {
                          const cfg = TYPE_CONFIG[email.emailType] || TYPE_CONFIG.estimate;
                          const isInbound = email.direction === "inbound";
                          const isActive = selectedEmail?.id === email.id;
                          return (
                            <button
                              key={email.id}
                              onClick={() => handleSelectEmail(email)}
                              className={`w-full text-left pl-8 pr-4 py-2.5 border-b border-zinc-800/30 hover:bg-zinc-800/40 transition-colors ${
                                isActive ? "bg-zinc-800/60" : ""
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={cfg.color}>{cfg.icon}</span>
                                <span className={`text-xs truncate flex-1 ${!email.isRead && isInbound ? "text-white font-medium" : "text-zinc-400"}`}>
                                  {isInbound ? (email.fromName || email.fromEmail || "Client") : `Sent to ${email.recipientEmail}`}
                                </span>
                                <span className="text-[10px] text-zinc-600 shrink-0">{timeSince(email.sentAt)}</span>
                              </div>
                              <p className="text-[11px] text-zinc-600 truncate pl-5 mt-0.5">{email.subject}</p>
                            </button>
                          );
                        })}
                        {group.estimateId && (
                          <Link href={`/estimates/${group.estimateId}`}>
                            <div className="pl-8 pr-4 py-2 text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1 cursor-pointer">
                              <ExternalLink className="w-3 h-3" /> Open Estimate
                            </div>
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel — detail */}
        <div className="flex-1 flex flex-col">
          {!selectedEmail ? (
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
                    <h2 className="text-sm font-semibold text-white mb-1">{selectedEmail.subject}</h2>
                    <p className="text-xs text-zinc-500">
                      {selectedEmail.direction === "inbound"
                        ? `From: ${selectedEmail.fromName || selectedEmail.fromEmail}`
                        : `To: ${selectedEmail.recipientEmail}`}
                      {" · "}{new Date(selectedEmail.sentAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {selectedEmail.estimateId && (
                      <Link href={`/estimates/${selectedEmail.estimateId}`}>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                          <ExternalLink className="w-3 h-3" /> Estimate
                        </Button>
                      </Link>
                    )}
                    {selectedEmail.estimateId && (
                      <Button size="sm" className="h-7 text-xs bg-orange-600 hover:bg-orange-700" onClick={() => setReplyOpen(r => !r)}>
                        <Send className="w-3 h-3 mr-1" /> Reply
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Reply composer */}
              {replyOpen && selectedEmail.estimateId && (
                <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900/50">
                  <Textarea
                    placeholder="Type your reply..."
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    className="mb-2 min-h-[80px] text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm" className="bg-orange-600 hover:bg-orange-700"
                      disabled={!replyText.trim() || replyMutation.isPending}
                      onClick={() => replyMutation.mutate({
                        estimateId: selectedEmail.estimateId!,
                        message: replyText,
                        threadId: selectedEmail.gmailThreadId || undefined,
                      })}
                    >
                      {replyMutation.isPending ? "Sending..." : "Send Reply"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)}>Cancel</Button>
                    <span className="text-xs text-zinc-500 ml-auto">Sends from your Gmail</span>
                  </div>
                </div>
              )}

              {/* Message body */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {selectedEmail.bodyHtml ? (
                  <div className="prose prose-sm prose-invert max-w-none text-zinc-300" dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }} />
                ) : (
                  <p className="text-sm text-zinc-400 whitespace-pre-wrap">{selectedEmail.bodyPreview || "(no content)"}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
