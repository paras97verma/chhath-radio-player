"use client";

/**
 * LiveChatDrawer — Neumorphic live chat panel for Chhath Radio.
 *
 * - FAB fixed bottom-right (above footer)
 * - Drawer slides in from right
 * - Real-time messages via SSE (chat_message events)
 * - Auto-scroll, optional name (sessionStorage), rate-limited send (3s cooldown)
 * - Neumorphic dark design
 *
 * Fixes applied:
 *   1. Listener count shown on FAB (collapsed state) — left of green dot
 *   2. Name field always visible in drawer with edit-chip toggle
 *   3. Messages persisted in sessionStorage (instant hydration on mount)
 *   4. Own messages added to state immediately (optimistic update) — no SSE wait
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchChatHistory, postChatMessage } from "@/lib/api";
import type { ChatMessage } from "@/lib/api";

const NAME_KEY     = "chhath_chat_name_v1";
const MESSAGES_KEY = "chhath_chat_messages_v1";
const API_BASE     = process.env.NEXT_PUBLIC_API_URL ?? "";

const NM_DRAWER = "12px 12px 32px rgba(0,0,0,0.82), -6px -6px 20px rgba(60,30,10,0.28), inset 0 1px 0 rgba(255,255,255,0.04)";
const NM_FAB    = "5px 5px 14px rgba(0,0,0,0.70), -3px -3px 8px rgba(60,30,10,0.28)";
const NM_INPUT  = "inset 3px 3px 8px rgba(0,0,0,0.60), inset -1px -1px 4px rgba(60,30,10,0.22)";
const NM_BTN    = "4px 4px 10px rgba(0,0,0,0.65), -2px -2px 6px rgba(60,30,10,0.28)";

// ─── sessionStorage helpers ────────────────────────────────────────────────────

function getSavedName(): string {
  try { return sessionStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
}
function saveName(name: string) {
  try { sessionStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}

function loadSessionMessages(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(MESSAGES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatMessage[];
  } catch { return []; }
}
function saveSessionMessages(msgs: ChatMessage[]) {
  try {
    // Keep last 100 messages to avoid bloating sessionStorage
    sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(msgs.slice(-100)));
  } catch { /* ignore */ }
}

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

interface Props { sessionId: string; listenerCount?: number | null; }

export default function LiveChatDrawer({ sessionId, listenerCount: listenerCountProp = null }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [myName, setMyName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [myMessageIds, setMyMessageIds] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOpenRef = useRef(false);

  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);

  // Load name from sessionStorage on mount
  useEffect(() => { setMyName(getSavedName()); }, []);

  // Fix 3: Hydrate messages from sessionStorage instantly, then replace with fresh API data
  useEffect(() => {
    const cached = loadSessionMessages();
    if (cached.length > 0) setMessages(cached);

    fetchChatHistory(50).then((msgs) => {
      setMessages(msgs);
      saveSessionMessages(msgs);
    });
  }, []);

  // SSE: real-time chat messages + listener count
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`${API_BASE}/api/events?session_id=${sessionId}`);

    es.addEventListener("chat_message", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const msg: ChatMessage = { id: data.id, name: data.name, text: data.text, ts: data.ts };
        setMessages((prev) => {
          // Deduplication: skip if already added optimistically
          if (prev.some((m) => m.id === msg.id)) return prev;
          const next = [...prev, msg];
          saveSessionMessages(next); // Fix 3: persist on every new message
          return next;
        });
        if (!isOpenRef.current) setUnreadCount((n) => n + 1);
      } catch { /* ignore */ }
    });

    return () => es.close();
  }, [sessionId]);

  // Auto-scroll when messages change (only if drawer is open)
  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  // On open: clear unread, focus appropriate input, scroll to bottom
  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      setTimeout(() => {
        // If no name set yet, focus the name input first so user can set it
        if (!myName.trim()) {
          nameInputRef.current?.focus();
        } else {
          inputRef.current?.focus();
        }
      }, 150);
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus name input when entering edit mode
  useEffect(() => {
    if (isEditingName) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isEditingName]);

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
    const trimmedName = myName.trim();
    if (trimmedName) saveName(trimmedName);
    setIsSending(true);
    setSendError(null);
    try {
      const msg = await postChatMessage(trimmedName, text);
      setMyMessageIds((prev) => new Set([...prev, msg.id]));

      // If user had no name set, persist the server-assigned random name for the session
      // so all subsequent messages use the same name
      if (!trimmedName && msg.name) {
        setMyName(msg.name);
        saveName(msg.name);
      }

      // Add own message to state immediately (optimistic update)
      // SSE deduplication above will skip it when the broadcast arrives
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        saveSessionMessages(next);
        return next;
      });

      setInputText("");
      startCooldown();
      // Re-focus input so the user can type the next message immediately
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setIsSending(false);
    }
  }, [inputText, myName, isSending, cooldown, startCooldown]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { saveName(myName.trim()); setIsEditingName(false); inputRef.current?.focus(); }
    if (e.key === "Escape") { setIsEditingName(false); inputRef.current?.focus(); }
  };

  const canSend = !!inputText.trim() && !isSending && cooldown === 0;

  const formattedListenerCount = listenerCountProp !== null && listenerCountProp !== undefined
    ? new Intl.NumberFormat("en-IN").format(listenerCountProp)
    : null;

  return (
    <>
      {/* ── FAB — pill-shaped, absolute within the player-row wrapper ── */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? "Close live chat" : "Open live chat"}
        title={isOpen ? "Close chat" : "Live Chat"}
        className="absolute top-1/2 -translate-y-1/2 z-[45] flex items-center cursor-pointer select-none pointer-events-auto"
        style={{
          right: "var(--hud-inset)",
          gap: isOpen ? 0 : "0.45rem",
          padding: isOpen ? "0.55rem" : "0.45rem 0.9rem 0.45rem 0.7rem",
          borderRadius: "9999px",
          border: isOpen ? "none" : "1.5px solid rgba(249,115,22,0.50)",
          background: isOpen
            ? "linear-gradient(135deg, #fb923c, #ea580c)"
            : "rgba(14,7,2,0.95)",
          boxShadow: isOpen
            ? "inset 3px 3px 8px rgba(0,0,0,0.55), 0 0 22px rgba(249,115,22,0.50)"
            : `${NM_FAB}, 0 0 16px rgba(249,115,22,0.28)`,
          transition: "all 0.25s cubic-bezier(0.34,1.4,0.64,1)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          minWidth: isOpen ? "2.5rem" : undefined,
          minHeight: "2.5rem",
          justifyContent: "center",
        }}
      >
        {isOpen ? (
          /* Close state — just an X icon, pill collapses to circle */
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white shrink-0">
            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        ) : (
          /* Open state — waveform icon + label + listener count + live dot */
          <>
            {/* Waveform / chat icon */}
            <span className="relative shrink-0 flex items-center justify-center w-[22px] h-[22px]">
              <svg viewBox="0 0 24 24" fill="none" className="w-[22px] h-[22px]">
                {/* Chat bubble with waveform bars inside */}
                <path
                  d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                  fill="rgba(249,115,22,0.18)"
                  stroke="rgba(249,115,22,0.85)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                {/* Waveform bars */}
                <rect x="7"  y="10" width="1.5" height="4" rx="0.75" fill="#fb923c"/>
                <rect x="10" y="8"  width="1.5" height="6" rx="0.75" fill="#fb923c"/>
                <rect x="13" y="9"  width="1.5" height="5" rx="0.75" fill="#fb923c"/>
                <rect x="16" y="11" width="1.5" height="3" rx="0.75" fill="#fb923c"/>
              </svg>
            </span>

            {/* Label */}
            <span
              className="text-[12px] font-semibold tracking-wide whitespace-nowrap"
              style={{ color: "rgba(249,115,22,0.95)" }}
            >
              Live Chat
            </span>

            {/* Fix 1: Listener count — shown left of the green dot */}
            {formattedListenerCount !== null && (
              <span
                className="text-[11px] font-bold tabular-nums whitespace-nowrap"
                style={{ color: "rgba(74,222,128,0.90)" }}
              >
                {formattedListenerCount}
              </span>
            )}

            {/* Live pulse dot */}
            <span className="relative flex shrink-0 w-2 h-2 ml-0.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
              <span className="relative inline-flex rounded-full w-2 h-2 bg-green-400" />
            </span>

            {/* Unread badge */}
            {unreadCount > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full
                           bg-red-500 text-white text-[10px] font-bold
                           flex items-center justify-center"
                style={{ boxShadow: "2px 2px 6px rgba(0,0,0,0.6)" }}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </>
        )}
      </button>

      {/* ── Chat drawer ── */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Live Chat"
          className="fixed z-[44] flex flex-col rounded-[20px] overflow-hidden pointer-events-auto"
          style={{
            bottom: "calc(var(--player-bottom) + var(--player-h) + var(--stack-gap))",
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
                  {messages.length} messages
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {listenerCountProp !== null && listenerCountProp !== undefined && (
                <span
                  className="text-[11px] font-semibold tabular-nums"
                  style={{ color: "rgba(74,222,128,0.90)" }}
                >
                  {new Intl.NumberFormat("en-IN").format(listenerCountProp)}
                </span>
              )}
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"
                   style={{ boxShadow: "0 0 6px #4ade80" }} />
            </div>
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

          {/* Fix 2: Name field — always visible, with edit-chip toggle */}
          <div className="px-3.5 pt-2 pb-1" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            {myName && !isEditingName ? (
              /* Chip mode: show name as editable pill */
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-white/30">Chatting as</span>
                <button
                  onClick={() => setIsEditingName(true)}
                  title="Click to change your name"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold
                             text-orange-400 transition-all hover:bg-orange-500/10"
                  style={{
                    background: "rgba(249,115,22,0.08)",
                    border: "1px solid rgba(249,115,22,0.25)",
                  }}
                >
                  {myName}
                  {/* Pencil icon */}
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5 opacity-60">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </button>
              </div>
            ) : (
              /* Input mode: editable name field */
              <input
                ref={nameInputRef}
                type="text"
                placeholder="Your name (optional) — Enter to save, Esc to cancel"
                maxLength={40}
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
                onKeyDown={handleNameKeyDown}
                className="w-full rounded-lg px-2.5 py-1.5 text-white/70 text-[11px] outline-none border-none"
                style={{ background: "rgba(15,8,4,0.88)", boxShadow: NM_INPUT }}
              />
            )}
          </div>

          {/* Message input */}
          <div className="px-3.5 pt-2 pb-3.5 shrink-0"
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
                className="flex-1 rounded-xl px-3 py-2 text-white text-[13px] outline-none border-none
                           transition-all"
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
                {cooldown > 0 ? cooldown : (
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                )}
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