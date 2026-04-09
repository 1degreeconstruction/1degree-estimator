import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "@/components/admin-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  MessageCircle, Send, ExternalLink, User, Clock,
} from "lucide-react";

interface ChatMsg {
  id: number;
  estimateId: number;
  senderType: string;
  senderName: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface EstimateSummary {
  id: number;
  estimateNumber: string;
  clientName: string;
  projectAddress: string;
  status: string;
}

function timeSince(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function TeamChat() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // All estimates (to build the conversation list)
  const { data: estimates = [] } = useQuery<EstimateSummary[]>({
    queryKey: ["/api/estimates"],
    select: (data: any) => (Array.isArray(data) ? data : []),
  });

  // Unread client messages
  const { data: unreadData } = useQuery<{ count: number; messages: ChatMsg[] }>({
    queryKey: ["/api/messages/unread"],
    refetchInterval: 15000,
  });

  // Messages for selected estimate
  const { data: messages = [], refetch: refetchMessages } = useQuery<ChatMsg[]>({
    queryKey: ["/api/estimates", selectedEstimateId, "messages"],
    queryFn: async () => {
      if (!selectedEstimateId) return [];
      const res = await apiRequest("GET", `/api/estimates/${selectedEstimateId}/messages`);
      return res.json();
    },
    enabled: !!selectedEstimateId,
    refetchInterval: selectedEstimateId ? 8000 : false,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/estimates/${selectedEstimateId}/messages`, { message: replyText });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => {
      setReplyText("");
      refetchMessages();
      qc.invalidateQueries({ queryKey: ["/api/messages/unread"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Build conversation list: estimates that have messages, sorted by latest message
  const unreadByEstimate: Record<number, number> = {};
  for (const m of (unreadData?.messages || [])) {
    unreadByEstimate[m.estimateId] = (unreadByEstimate[m.estimateId] || 0) + 1;
  }

  // Get all estimate IDs that have unread messages — these go first
  const estimateIdsWithUnread = Object.keys(unreadByEstimate).map(Number);
  const conversationEstimates = estimates.filter(e =>
    estimateIdsWithUnread.includes(e.id) || e.status === "sent" || e.status === "viewed" || e.status === "approved"
  ).sort((a, b) => {
    const aUnread = unreadByEstimate[a.id] || 0;
    const bUnread = unreadByEstimate[b.id] || 0;
    if (aUnread && !bUnread) return -1;
    if (!aUnread && bUnread) return 1;
    return 0;
  });

  const selectedEstimate = estimates.find(e => e.id === selectedEstimateId);

  return (
    <AdminLayout>
      <div className="flex h-[calc(100vh-60px)]">
        {/* Left — conversation list */}
        <div className="w-80 border-r border-zinc-800 flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-orange-400" />
            <span className="font-semibold text-sm">Client Messages</span>
            {(unreadData?.count || 0) > 0 && (
              <Badge className="bg-orange-500/20 text-orange-400 border-0 text-xs px-1.5">{unreadData?.count}</Badge>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversationEstimates.length === 0 ? (
              <div className="p-6 text-sm text-zinc-500 text-center">No active conversations yet.</div>
            ) : (
              conversationEstimates.map(est => {
                const unread = unreadByEstimate[est.id] || 0;
                const active = selectedEstimateId === est.id;
                return (
                  <button
                    key={est.id}
                    onClick={() => setSelectedEstimateId(est.id)}
                    className={`w-full text-left px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/40 transition-colors ${
                      active ? "bg-zinc-800/60" : ""
                    } ${unread > 0 ? "border-l-2 border-l-orange-500" : ""}`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-xs font-medium truncate ${unread ? "text-white" : "text-zinc-300"}`}>
                        {est.clientName}
                      </span>
                      {unread > 0 && (
                        <Badge className="bg-orange-500 text-white border-0 text-[10px] px-1.5 py-0 h-4">{unread}</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate">{est.estimateNumber}</div>
                    <div className="text-[11px] text-zinc-600 truncate">{est.projectAddress}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right — chat thread */}
        <div className="flex-1 flex flex-col">
          {!selectedEstimateId ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-zinc-600">
                <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Select a conversation</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">{selectedEstimate?.clientName}</h2>
                  <p className="text-xs text-zinc-500">{selectedEstimate?.estimateNumber} - {selectedEstimate?.projectAddress}</p>
                </div>
                <Link href={`/estimates/${selectedEstimateId}`}>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                    <ExternalLink className="w-3 h-3" /> View Estimate
                  </Button>
                </Link>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-zinc-950/30">
                {messages.length === 0 && (
                  <div className="text-center text-zinc-600 text-xs mt-8">No messages yet for this estimate.</div>
                )}
                {messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.senderType === "team" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] rounded-lg px-3.5 py-2.5 text-sm ${
                      msg.senderType === "team"
                        ? "bg-primary text-primary-foreground rounded-br-none"
                        : "bg-zinc-800 text-zinc-200 rounded-bl-none"
                    }`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <User className="w-3 h-3 opacity-60" />
                        <span className="text-[10px] font-semibold opacity-70">{msg.senderName}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{msg.message}</p>
                      <div className="flex items-center gap-1 mt-1.5 opacity-50">
                        <Clock className="w-2.5 h-2.5" />
                        <span className="text-[10px]">{timeSince(msg.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Reply input */}
              <div className="p-3 border-t border-zinc-800">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && replyText.trim() && sendMutation.mutate()}
                    placeholder="Type a reply..."
                    className="flex-1 text-sm bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
                    data-testid="input-team-reply"
                  />
                  <Button
                    onClick={() => sendMutation.mutate()}
                    disabled={!replyText.trim() || sendMutation.isPending}
                    className="bg-orange-600 hover:bg-orange-700 px-4"
                    data-testid="button-team-send"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
