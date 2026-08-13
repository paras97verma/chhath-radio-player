"use client";

/**
 * LiveChatDrawer — Neumorphic live chat panel for Chhath Radio.
 *
 * - FAB fixed bottom-right (above footer)
 * - Drawer slides in from right
 * - Real-time messages via SSE (chat_message events)
 * - Auto-scroll, anonymous name, rate-limited send (3s cooldown)
 * - Neumorphic dark design
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchChatHistory, postChatMessage } from "@/lib/api";
import type { ChatMessage } from "@/lib/api";

const NAME_KEY = "chhath_chat_name_v1";
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

const NM_DRAWER = "12px 12px 32px rgba(0,0,0,0.82), -6px -6px 20px rgba(60,30,10,0.28), inset 0 1px 0 rgba(255,255,255,0.04)";
const NM_FAB    = "5px 5px 14px rgba(0,0,0,0.70), -3px -3px 8px rgba(60,30,10,0.28)";
const NM_INPUT  = "inset 3px 3px 8px rgba(0,0,0,0.60), inset -1px -1px 4px rgba(60,30,10,0.22)";
const NM_BTN    = "4px 4px 10px rgba(0,0,0,0.65), -2px -2px 6px rgba(60,30,10,0.28)";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSavedName(): string { try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; } }
function saveName(name: string) { try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ } }
function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, isOwn }: { msg: ChatMessage; isOwn: boolean }) {
  return (
    <div
      className={`flex flex-col mb-2.5 ${isOwn ? "items-end" : "items-start"}`}
      style={{ animation: "chatMsgIn 0.2s ease forwards" }}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`text-[10px] font-bold max-w-[160px] truncate ${isOwn ? "text-orange-400" : "text-white/55"}`}>
          {msg.name}
        </span>
        <span className="text-[9px] text-white/20">{formatTime(msg.ts)}</span>
      </div>
      <div
        className={`max-w-[85%] px-3 py-1.5 text-[13px] leading-[1.45] break-words`}
        style={{
          borderRadius: isOwn ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          background: isOwn
            ? "linear-gradient(135deg, rgba(249,115,22,0.30), rgba(234,88,12,0.20))"
            : "rgba(255,255,255,0.06)",
          boxShadow: isOwn
            ? "inset 2px 2px 6px rgba(0,0,0,0.40), inset -1px -1px 3px rgba(60,30,10,0.18)"
            : "inset 2px 2px 6px rgba(0,0,0,0.35), inset -1px -1px 3px rgba(60,30,10,0.15)",
          color: isOwn ? "#fff" : "rgba(255,255,255,0.85)",
        }}
      >
        {msg.text}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { sessionId: string; }

export default function LiveChatDrawer({ sessionId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [myName, setMyName] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [myMessageIds, setMyMessageIds] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOpenRef = useRef(false);

  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  useEffect(() => { setMyName(getSavedName()); }, []);
  useEffect(() => { fetchChatHistory(50).then((msgs) => setMessages(msgs)); }, []);

  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`${API_BASE}/api/events?session_id=${sessionId}`);
    es.addEventListener("chat_message", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const msg: ChatMessage = { id: data.id, name: data.name, text: data.text, ts: data.ts };
        setMessages((prev) => { if (prev.some((m) => m.id === msg.id)) return prev; return [...prev, msg]; });
        if (!isOpenRef.current) setUnreadCount((n) => n + 1);
      } catch { /* ignore */ }
    });
    return () => es.close();
  }, [sessionId]);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      setTimeout(() => inputRef.current?.focus(), 150);
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [isOpen]);

  const startCooldown = useCallback(() => {
    setCooldown(3);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => { if (prev <= 1) { clearInterval(cooldownRef.current!); return 0; } return prev - 1; });
    }, 1000);
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSending || cooldown > 0) return;
    const name = myName.trim() || undefined;
    if (name) saveName(name);
    setIsSending(true);
    setSendError(null);
    try {
      const msg = await postChatMessage(name ?? "", text);
      setMyMessageIds((prev) => new Set([...prev, msg.id]));
      setInputText("");
      startCooldown();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setIsSending(false);
    }
  }, [inputText, myName, isSending, cooldown, startCooldown]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const canSend = !!inputText.trim() && !isSending && cooldown === 0;

  return (
    <>
      {/* ── FAB — fixed bottom-right, above footer ── */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? "Close live chat" : "Open live chat"}
        title={isOpen ? "Close chat" : "Live Chat"}
        className="fixed z-[45] w-12 h-12 rounded-full flex items-center justify-center
                   text-xl cursor-pointer border-none transition-all duration-200"
        style={{
          bottom: "var(--chat-fab-bottom)",
          right: "var(--hud-inset)",
          background: isOpen ? "linear-gradient(135deg, #fb923c, #ea580c)" : "rgba(15,8,4,0.92)",
          boxShadow: isOpen
            ? "inset 3px 3px 8px rgba(0,0,0,0.55), 0 0 20px rgba(249,115,22,0.45)"
            : NM_FAB,
        }}
      >
        {isOpen ? "✕" : "💬"}
        {!isOpen && unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full
                       bg-red-500 text-white text-[10px] font-bold
                       flex items-center justify-center"
            style={{ boxShadow: "2px 2px 6px rgba(0,0,0,0.6)" }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* ── Chat drawer ── */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Live Chat"
          className="fixed z-[44] flex flex-col rounded-[20px] overflow-hidden"
          style={{
            bottom: "calc(var(--chat-fab-bottom) + 3.5rem + var(--stack-gap))",
            right: "var(--hud-inset)",
            width: "min(92vw, 340px)",
            height: "min(70vh, 520px)",
            background: "rgba(10,4,2,0.97)",
            boxShadow: NM_DRAWER,
            animation: "chatDrawerIn 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ borderBottom: "1px solid rgba(249,115,22,0.10)" }}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">💬</span>
              <div>
                <p className="text-orange-400 font-bold text-[13px] m-0">Live Chat</p>
                <p className="text-white/30 text-[10px] m-0">
                  {messages.length} messages · Listening together 🪔
                </p>
              </div>
            </div>
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"
                 style={{ boxShadow: "0 0 6px #4ade80" }} />
          </div>

          {/* Messages */}
          <div className="chat-scrollbar flex-1 overflow-y-auto px-3.5 py-3 flex flex-col">
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-white/20 text-[13px] text-center gap-2">
                <span className="text-3xl">🪔</span>
                <p className="m-0">Be the first to say<br />Jai Chhathi Maiya!</p>
              </div>
            ) : (
              messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} isOwn={myMessageIds.has(msg.id)} />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Name input (if not set) */}
          {!myName && (
            <div className="px-3.5 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <input
                type="text"
                placeholder="Your name (optional)"
                maxLength={40}
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
                onBlur={() => { if (myName.trim()) saveName(myName.trim()); }}
                className="w-full rounded-lg px-2.5 py-1.5 text-white/60 text-[11px] outline-none border-none"
                style={{ background: "rgba(15,8,4,0.88)", boxShadow: NM_INPUT }}
              />
            </div>
          )}

          {/* Message input */}
          <div className="px-3.5 pt-2.5 pb-3.5 shrink-0"
               style={{ borderTop: "1px solid rgba(249,115,22,0.08)" }}>
            {sendError && <p className="text-red-400 text-[11px] mb-1.5">{sendError}</p>}
            <div className="flex gap-2 items-end">
              <input
                ref={inputRef}
                type="text"
                placeholder="Jai Chhathi Maiya! 🪔"
                maxLength={200}
                value={inputText}
                onChange={(e) => { setInputText(e.target.value); setSendError(null); }}
                onKeyDown={handleKeyDown}
                disabled={isSending}
                className="flex-1 rounded-xl px-3 py-2 text-white text-[13px] outline-none border-none
                           disabled:opacity-50 transition-all"
                style={{ background: "rgba(15,8,4,0.88)", boxShadow: NM_INPUT }}
              />
              <button
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send message"
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0
                           font-bold border-none cursor-pointer transition-all duration-200
                           disabled:cursor-not-allowed"
                style={{
                  background: canSend ? "linear-gradient(135deg, #fb923c, #ea580c)" : "rgba(15,8,4,0.88)",
                  color: canSend ? "#fff" : "rgba(255,255,255,0.20)",
                  boxShadow: canSend
                    ? `${NM_BTN}, 0 0 12px rgba(249,115,22,0.35)`
                    : NM_BTN,
                  fontSize: cooldown > 0 ? 11 : 16,
                }}
              >
                {cooldown > 0 ? cooldown : "🪔"}
              </button>
            </div>
            <p className="text-white/15 text-[10px] mt-1.5 text-center">
              Anonymous · No account needed · Press Enter to send
            </p>
          </div>
        </div>
      )}
    </>
  );
}