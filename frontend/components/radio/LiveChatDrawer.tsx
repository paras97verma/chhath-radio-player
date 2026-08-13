"use client";

/**
 * LiveChatDrawer — YouTube-style live chat panel for Chhath Radio.
 *
 * Features:
 * - Collapsible drawer anchored to the right side of the screen
 * - FAB button with unread count badge when collapsed
 * - Real-time messages via SSE (chat_message events)
 * - Auto-scroll to bottom on new messages
 * - Anonymous name auto-generated (stored in localStorage)
 * - Rate-limited send (3s cooldown, enforced by backend)
 * - Glassmorphic dark design matching the app aesthetic
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchChatHistory, postChatMessage } from "@/lib/api";
import type { ChatMessage } from "@/lib/api";

const NAME_KEY = "chhath_chat_name_v1";
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSavedName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
}

function saveName(name: string) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, isOwn }: { msg: ChatMessage; isOwn: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isOwn ? "flex-end" : "flex-start",
        marginBottom: 10,
        animation: "chatMsgIn 0.2s ease forwards",
      }}
    >
      {/* Name + time */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          color: isOwn ? "#fb923c" : "rgba(255,255,255,0.55)",
          maxWidth: 160,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {msg.name}
        </span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
          {formatTime(msg.ts)}
        </span>
      </div>

      {/* Bubble */}
      <div style={{
        maxWidth: "85%",
        padding: "7px 11px",
        borderRadius: isOwn ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        background: isOwn
          ? "linear-gradient(135deg, rgba(249,115,22,0.35), rgba(234,88,12,0.25))"
          : "rgba(255,255,255,0.07)",
        border: isOwn
          ? "1px solid rgba(249,115,22,0.4)"
          : "1px solid rgba(255,255,255,0.08)",
        color: isOwn ? "#fff" : "rgba(255,255,255,0.85)",
        fontSize: 13,
        lineHeight: 1.45,
        wordBreak: "break-word",
      }}>
        {msg.text}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  sessionId: string;
}

export default function LiveChatDrawer({ sessionId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [myName, setMyName] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [cooldown, setCooldown] = useState(0); // seconds remaining
  const [myMessageIds, setMyMessageIds] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOpenRef = useRef(false);

  // Keep ref in sync
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);

  // Load saved name on mount
  useEffect(() => {
    setMyName(getSavedName());
  }, []);

  // Load chat history on mount
  useEffect(() => {
    fetchChatHistory(50).then((msgs) => {
      setMessages(msgs);
    });
  }, []);

  // SSE: listen for chat_message events on the existing /api/events stream
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`${API_BASE}/api/events?session_id=${sessionId}`);

    es.addEventListener("chat_message", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const msg: ChatMessage = {
          id: data.id,
          name: data.name,
          text: data.text,
          ts: data.ts,
        };
        setMessages((prev) => {
          // Deduplicate
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        // Increment unread if drawer is closed
        if (!isOpenRef.current) {
          setUnreadCount((n) => n + 1);
        }
      } catch { /* ignore malformed */ }
    });

    return () => es.close();
  }, [sessionId]);

  // Auto-scroll to bottom when messages change and drawer is open
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  // Focus input when drawer opens
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
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <style>{`
        @keyframes chatMsgIn {
          0%   { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes chatDrawerIn {
          0%   { opacity: 0; transform: translateX(20px) scale(0.97); }
          100% { opacity: 1; transform: translateX(0) scale(1); }
        }
        .chat-scrollbar::-webkit-scrollbar { width: 4px; }
        .chat-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .chat-scrollbar::-webkit-scrollbar-thumb { background: rgba(249,115,22,0.3); border-radius: 2px; }
      `}</style>

      {/* ── FAB toggle button ── */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? "Close live chat" : "Open live chat"}
        title={isOpen ? "Close chat" : "Live Chat"}
        style={{
          position: "fixed",
          bottom: 100,
          right: 20,
          zIndex: 45,
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: isOpen
            ? "linear-gradient(135deg, #fb923c, #ea580c)"
            : "rgba(10,4,2,0.92)",
          border: "1px solid rgba(249,115,22,0.45)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(249,115,22,0.1)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          transition: "all 0.2s ease",
          backdropFilter: "blur(12px)",
        }}
      >
        {isOpen ? "✕" : "💬"}
        {/* Unread badge */}
        {!isOpen && unreadCount > 0 && (
          <span style={{
            position: "absolute",
            top: -4,
            right: -4,
            background: "#ef4444",
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            borderRadius: "50%",
            width: 18,
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid rgba(10,4,2,0.9)",
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* ── Chat drawer ── */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Live Chat"
          style={{
            position: "fixed",
            bottom: 160,
            right: 20,
            zIndex: 44,
            width: "min(92vw, 340px)",
            height: "min(70vh, 520px)",
            display: "flex",
            flexDirection: "column",
            background: "rgba(8,3,1,0.97)",
            border: "1px solid rgba(249,115,22,0.25)",
            borderRadius: 20,
            boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(249,115,22,0.06)",
            backdropFilter: "blur(32px)",
            animation: "chatDrawerIn 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{
            padding: "12px 16px",
            borderBottom: "1px solid rgba(249,115,22,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>💬</span>
              <div>
                <p style={{ color: "#fb923c", fontWeight: 700, fontSize: 13, margin: 0 }}>
                  Live Chat
                </p>
                <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, margin: 0 }}>
                  {messages.length} messages · Listening together 🪔
                </p>
              </div>
            </div>
            <div style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#4ade80",
              boxShadow: "0 0 6px #4ade80",
              animation: "pulse 2s infinite",
            }} />
          </div>

          {/* Messages list */}
          <div
            className="chat-scrollbar"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {messages.length === 0 ? (
              <div style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,0.2)",
                fontSize: 13,
                textAlign: "center",
                gap: 8,
              }}>
                <span style={{ fontSize: 32 }}>🪔</span>
                <p style={{ margin: 0 }}>Be the first to say<br />Jai Chhathi Maiya!</p>
              </div>
            ) : (
              messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isOwn={myMessageIds.has(msg.id)}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Name input (shown only if name not set) */}
          {!myName && (
            <div style={{
              padding: "8px 14px 0",
              borderTop: "1px solid rgba(255,255,255,0.05)",
            }}>
              <input
                type="text"
                placeholder="Your name (optional)"
                maxLength={40}
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
                onBlur={() => { if (myName.trim()) saveName(myName.trim()); }}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8,
                  padding: "6px 10px",
                  color: "rgba(255,255,255,0.6)",
                  fontSize: 11,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {/* Message input */}
          <div style={{
            padding: "10px 14px 14px",
            borderTop: "1px solid rgba(249,115,22,0.1)",
            flexShrink: 0,
          }}>
            {sendError && (
              <p style={{ color: "#f87171", fontSize: 11, marginBottom: 6, margin: "0 0 6px" }}>
                {sendError}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <input
                ref={inputRef}
                type="text"
                placeholder="Jai Chhathi Maiya! 🪔"
                maxLength={200}
                value={inputText}
                onChange={(e) => { setInputText(e.target.value); setSendError(null); }}
                onKeyDown={handleKeyDown}
                disabled={isSending}
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(249,115,22,0.2)",
                  borderRadius: 12,
                  padding: "9px 12px",
                  color: "#fff",
                  fontSize: 13,
                  outline: "none",
                  transition: "border-color 0.2s",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => { e.target.style.borderColor = "rgba(249,115,22,0.5)"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(249,115,22,0.2)"; }}
              />
              <button
                onClick={handleSend}
                disabled={!inputText.trim() || isSending || cooldown > 0}
                aria-label="Send message"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: inputText.trim() && !isSending && cooldown === 0
                    ? "linear-gradient(135deg, #fb923c, #ea580c)"
                    : "rgba(255,255,255,0.06)",
                  border: "none",
                  color: inputText.trim() && !isSending && cooldown === 0
                    ? "#fff"
                    : "rgba(255,255,255,0.2)",
                  cursor: inputText.trim() && !isSending && cooldown === 0
                    ? "pointer"
                    : "not-allowed",
                  fontSize: cooldown > 0 ? 11 : 16,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "all 0.2s",
                  boxShadow: inputText.trim() && !isSending && cooldown === 0
                    ? "0 0 12px rgba(249,115,22,0.4)"
                    : "none",
                }}
              >
                {cooldown > 0 ? cooldown : "🪔"}
              </button>
            </div>
            <p style={{ color: "rgba(255,255,255,0.15)", fontSize: 10, marginTop: 6, textAlign: "center" }}>
              Anonymous · No account needed · Press Enter to send
            </p>
          </div>
        </div>
      )}
    </>
  );
}