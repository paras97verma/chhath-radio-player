"use client";

/**
 * LiveChatDrawer — Neumorphic live chat panel for Chhath Radio.
 *
 * Transport: WebSocket (/api/ws/chat?session_id=<uuid>)
 *   - On connect: server sends {"type":"history","messages":[...]}
 *   - Incoming: {"type":"chat_message","id":"...","name":"...","text":"...","ts":0}
 *   - Outgoing: {"name":"...","text":"..."} sent directly over the socket
 *   - Ping: {"ping":true} sent every 20 s to keep Render free-tier alive
 *   - Reconnect: exponential back-off (1 s → 2 s → 4 s … max 30 s)
 *
 * Features:
 *   - FAB fixed right of player pill (desktop) / controlled bottom-sheet (mobile)
 *   - Real-time messages via WebSocket broadcast
 *   - Own messages shown on right (orange) — persisted in sessionStorage across refresh
 *   - Unread badge increments for messages received while drawer is closed
 *   - Name persisted in sessionStorage; random bhakti name assigned if blank
 *   - Auto-scroll, 3 s send cooldown, optimistic message add
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { connectChatWebSocket, sendChatMessageWs } from "@/lib/api";
import type { ChatMessage, ChatWsEvent } from "@/lib/api";

const NAME_KEY        = "chhath_chat_name_v1";
const MESSAGES_KEY    = "chhath_chat_messages_v1";
const MY_IDS_KEY      = "chhath_chat_my_ids_v1";
const NOTICE_SEEN_KEY = "chhath_chat_notice_seen_v1";
const PING_INTERVAL   = 20_000;   // 20 s — keeps Render free-tier WS alive
const MAX_RECONNECT   = 30_000;   // 30 s max back-off

// ─── Bhakti name pool — assigned on the frontend when user skips the name field ─
// Names are fun, festival-themed, and can be duplicated across users.
const BHAKTI_NAMES = [
  "🌸 Mahua_Ke_Phool",
  "🎵 Chhath_Geet_Lover",
  "🌊 Ghat_Pe_Khada_Bhakt",
  "🪔 Mitti_Ka_Diya",
  "🙏 Jai_Chhathi_Maiya",
  "☀️ Surya_Namaskar_Wala",
  "🌸 Kaddu_Bhaat_Fan",
  "🎵 Radio_Sunne_Wala",
  "🌊 Patna_Ka_Bhakt",
  "🪔 Varanasi_Wala",
  "🙏 Muzaffarpur_Bhakt",
  "☀️ Bhagalpur_Ka_Fan",
  "🌸 Darbhanga_Wali",
  "🎵 Ara_Ka_Bhakt",
  "🌊 Chapra_Wala",
  "🪔 Sitamarhi_Bhakt",
  "🙏 Delhi_Wala_Bhakt",
  "☀️ Mumbai_Ka_Chhath_Fan",
  "🌸 Kolkata_Wali_Maiya",
  "🌊 Geet_Sunne_Wala",
  "🪔 Usha_Arghya_Wala",
  "🙏 Sandhya_Arghya_Fan",
  "☀️ Chhath_Ke_Bhakt",
  // 20 new fun names
  "🌺 Thekua_Khane_Wala",
  "🎶 Parampara_Ka_Bhakt",
  "🌅 Suraj_Ke_Deewane",
  "🪷 Kamal_Ke_Phool_Fan",
  "🎊 Chhath_Mahotsav_Wala",
  "🌾 Khet_Ka_Bhakt",
  "🏞️ Ganga_Kinare_Wala",
  "🌙 Raat_Ke_Jaagran_Fan",
  "🎤 Chhath_Geet_Gaane_Wala",
  "🌻 Surya_Dev_Ka_Sevak",
  "🪅 Puja_Ke_Rang_Wala",
  "🌈 Chhath_Ki_Khushi_Fan",
  "🏔️ Pahad_Ka_Bhakt",
  "🌊 Sone_Ki_Naiya_Wala",
  "🎵 Dholak_Bajane_Wala",
  "🪔 Deep_Jalane_Wali",
  "🌸 Arghya_Dene_Wali",
  "☀️ Bhor_Ka_Suraj_Fan",
  "🙏 Chhathi_Maiya_Sevak",
  "🌺 Prasad_Banane_Wali",
];

function pickRandomBhaktiName(): string {
  return BHAKTI_NAMES[Math.floor(Math.random() * BHAKTI_NAMES.length)];
}

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
    sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(msgs.slice(-100)));
  } catch { /* ignore */ }
}

function loadMyIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(MY_IDS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch { return new Set(); }
}
function saveMyIds(ids: Set<string>) {
  try {
    // Keep only the last 200 IDs to avoid bloating sessionStorage
    const arr = Array.from(ids).slice(-200);
    sessionStorage.setItem(MY_IDS_KEY, JSON.stringify(arr));
  } catch { /* ignore */ }
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
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
        className="max-w-[85%] px-3 py-1.5 text-[13px] leading-[1.45] break-words"
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

interface Props {
  sessionId: string;
  listenerCount?: number | null;
  /** Mobile bottom-sheet mode: open/close controlled externally */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  /** Called whenever the unread count changes — lets the parent show a badge */
  onUnreadChange?: (count: number) => void;
}

export default function LiveChatDrawer({
  sessionId,
  listenerCount: listenerCountProp = null,
  mobileOpen,
  onMobileClose,
  onUnreadChange,
}: Props) {
  const isMobileControlled = mobileOpen !== undefined;
  const [isOpen, setIsOpen] = useState(false);
  const effectiveOpen = isMobileControlled ? (mobileOpen ?? false) : isOpen;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [myMessageIds, setMyMessageIds] = useState<Set<string>>(new Set());
  const [inputText, setInputText] = useState("");
  const [myName, setMyName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [showFirstTimeNotice, setShowFirstTimeNotice] = useState(false);

  const messagesEndRef   = useRef<HTMLDivElement>(null);
  const inputRef         = useRef<HTMLInputElement>(null);
  const nameInputRef     = useRef<HTMLInputElement>(null);
  const cooldownRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOpenRef        = useRef(false);
  const wsRef            = useRef<WebSocket | null>(null);
  const reconnectTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer        = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttempt = useRef(0);
  const unmountedRef     = useRef(false);
  // nonce → sentAt (ms): used to identify our own echoed messages
  const pendingNonces    = useRef<Map<string, number>>(new Map());

  useEffect(() => { isOpenRef.current = effectiveOpen; }, [effectiveOpen]);

  // ── Hydrate name + IDs from sessionStorage on mount ──────────────────────
  useEffect(() => {
    const saved = getSavedName();
    setMyName(saved);
    setNameInput(saved);
    setMyMessageIds(loadMyIds());

    // Hydrate messages from sessionStorage instantly (before WS connects)
    const cached = loadSessionMessages();
    if (cached.length > 0) setMessages(cached);
  }, []);

  // ── WebSocket connection with exponential reconnect ───────────────────────
  const connectWs = useCallback(() => {
    if (unmountedRef.current || !sessionId) return;

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent reconnect loop on intentional close
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null; }

    const ws = connectChatWebSocket(sessionId, (event: ChatWsEvent) => {
      if (unmountedRef.current) return;

      if (event.type === "history") {
        // Replace messages with authoritative history from server.
        // Cross-reference with persisted myMessageIds so own messages stay right-aligned.
        setMessages(event.messages);
        saveSessionMessages(event.messages);
        // myMessageIds already loaded from sessionStorage — no change needed here
      } else if (event.type === "chat_message") {
        const msg: ChatMessage = {
          id: event.id,
          name: event.name,
          text: event.text,
          ts: event.ts,
        };

        // Check if this echo belongs to us via nonce matching.
        // The server echoes the _nonce field back in the broadcast payload.
        const echoNonce = event._nonce;
        const isOwnEcho = echoNonce ? pendingNonces.current.has(echoNonce) : false;
        if (echoNonce) pendingNonces.current.delete(echoNonce);

        // Clean up stale nonces older than 10 s
        const now = Date.now();
        for (const [n, t] of pendingNonces.current) {
          if (now - t > 10_000) pendingNonces.current.delete(n);
        }

        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev; // dedup
          const next = [...prev, msg];
          saveSessionMessages(next);
          return next;
        });

        if (isOwnEcho) {
          // Mark this message ID as ours and persist so it survives refresh
          setMyMessageIds((ids) => {
            const next = new Set(ids);
            next.add(msg.id);
            saveMyIds(next);
            return next;
          });
        } else if (!isOpenRef.current) {
          // Only increment unread for messages from others while drawer is closed
          setUnreadCount((n) => n + 1);
        }
      } else if (event.type === "error") {
        // Suppress spurious "text cannot be empty" errors — these are triggered
        // by the keep-alive ping {"ping":true} on older server versions that
        // don't yet handle pings silently. Only show real user-facing errors.
        const detail = event.detail ?? "";
        if (!detail.toLowerCase().includes("cannot be empty")) {
          setSendError(detail);
        }
        setIsSending(false);
      }
    });

    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) return;
      setWsConnected(true);
      reconnectAttempt.current = 0;

      // Ping every 20 s to keep Render free-tier connection alive
      pingTimer.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ ping: true }));
        }
      }, PING_INTERVAL);
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setWsConnected(false);
      if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null; }

      // Exponential back-off: 1s, 2s, 4s, 8s, 16s, 30s (max)
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), MAX_RECONNECT);
      reconnectAttempt.current += 1;
      reconnectTimer.current = setTimeout(connectWs, delay);
    };

    ws.onerror = () => {
      // onclose fires after onerror — reconnect handled there
      setWsConnected(false);
    };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    unmountedRef.current = false;
    connectWs();
    return () => {
      unmountedRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional unmount
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWs]);

  // ── Auto-scroll when messages change (only if drawer is open) ────────────
  useEffect(() => {
    if (effectiveOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, effectiveOpen]);

  // ── On open: clear unread, focus input, scroll to bottom ─────────────────
  useEffect(() => {
    if (effectiveOpen) {
      setUnreadCount(0);
      setTimeout(() => {
        if (!myName.trim()) {
          nameInputRef.current?.focus();
        } else {
          inputRef.current?.focus();
        }
      }, 150);
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [effectiveOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── First-time user notice: show brief 3s floating toast on first chat open, then vanish forever ─
  useEffect(() => {
    if (!effectiveOpen) return;
    try {
      const hasSeen = localStorage.getItem(NOTICE_SEEN_KEY);
      if (!hasSeen) {
        setShowFirstTimeNotice(true);
        localStorage.setItem(NOTICE_SEEN_KEY, "true");
        const timer = setTimeout(() => {
          setShowFirstTimeNotice(false);
        }, 3000);
        return () => clearTimeout(timer);
      }
    } catch {
      // ignore storage errors
    }
  }, [effectiveOpen]);

  // ── Focus name input when entering edit mode ──────────────────────────────
  useEffect(() => {
    if (isEditingName) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isEditingName]);

  // ── Notify parent of unread count changes ─────────────────────────────────
  useEffect(() => {
    onUnreadChange?.(unreadCount);
  }, [unreadCount, onUnreadChange]);

  const startCooldown = useCallback(() => {
    setCooldown(3);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) { clearInterval(cooldownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleSendWithNonce = useCallback(() => {
    const text = inputText.trim();
    if (!text || isSending || cooldown > 0) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setSendError("Not connected — reconnecting…");
      return;
    }

    // Always send a name — if somehow empty (edge case), pick from pool and persist.
    let trimmedName = myName.trim();
    if (!trimmedName) {
      trimmedName = pickRandomBhaktiName();
      setMyName(trimmedName);
      setNameInput(trimmedName);
    }
    saveName(trimmedName);

    // Generate a nonce to identify our own echo.
    // Needed because names can be duplicated — nonce is the only reliable way
    // to identify which broadcast belongs to this sender.
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingNonces.current.set(nonce, Date.now());

    setIsSending(true);
    setSendError(null);

    // Send with nonce embedded — server broadcasts it back so we can identify our echo
    if (wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ name: trimmedName, text, _nonce: nonce }));
    }

    setInputText("");
    setIsSending(false);
    startCooldown();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [inputText, myName, isSending, cooldown, startCooldown]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendWithNonce(); }
  };

  const commitName = () => {
    const trimmed = nameInput.trim();
    // Only persist if the user actually typed a name.
    // If blank and we already have a name (e.g. server-assigned random name),
    // keep the existing name so it doesn't vanish on blur.
    if (trimmed) {
      setMyName(trimmed);
      saveName(trimmed);
    }
    setIsEditingName(false);
    inputRef.current?.focus();
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { commitName(); }
    if (e.key === "Escape") {
      setNameInput(myName);
      setIsEditingName(false);
      inputRef.current?.focus();
    }
  };

  const canSend = !!inputText.trim() && !isSending && cooldown === 0 && wsConnected;

  const handleClose = () => {
    if (isMobileControlled) {
      onMobileClose?.();
    } else {
      setIsOpen(false);
    }
  };

  return (
    <>
      {/* ── FAB — desktop only, hidden when drawer is open (drawer has its own close button) ── */}
      {!isMobileControlled && !effectiveOpen && (
        <button
          onClick={() => setIsOpen((v) => !v)}
          aria-label={effectiveOpen ? "Close live chat" : "Open live chat"}
          title={effectiveOpen ? "Close chat" : "Community Chat"}
          className="fixed z-[45] flex items-center cursor-pointer select-none pointer-events-auto"
          style={{
            bottom: "var(--chat-fab-bottom)",
            right: "var(--hud-inset)",
            gap: effectiveOpen ? 0 : "0.45rem",
            padding: effectiveOpen ? "0.55rem" : "0.45rem 0.9rem 0.45rem 0.7rem",
            borderRadius: "9999px",
            border: effectiveOpen ? "none" : "1.5px solid rgba(249,115,22,0.50)",
            background: effectiveOpen
              ? "linear-gradient(135deg, #fb923c, #ea580c)"
              : "rgba(14,7,2,0.95)",
            boxShadow: effectiveOpen
              ? "inset 3px 3px 8px rgba(0,0,0,0.55), 0 0 22px rgba(249,115,22,0.50)"
              : `${NM_FAB}, 0 0 16px rgba(249,115,22,0.28)`,
            transition: "all 0.25s cubic-bezier(0.34,1.4,0.64,1)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            minWidth: effectiveOpen ? "2.5rem" : undefined,
            minHeight: "2.5rem",
            justifyContent: "center",
          }}
        >
          {effectiveOpen ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white shrink-0">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          ) : (
            <>
              <span className="relative shrink-0 flex items-center justify-center w-[22px] h-[22px]">
                <svg viewBox="0 0 24 24" fill="none" className="w-[22px] h-[22px]">
                  <path
                    d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                    fill="rgba(249,115,22,0.18)"
                    stroke="rgba(249,115,22,0.85)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <rect x="7"  y="10" width="1.5" height="4" rx="0.75" fill="#fb923c"/>
                  <rect x="10" y="8"  width="1.5" height="6" rx="0.75" fill="#fb923c"/>
                  <rect x="13" y="9"  width="1.5" height="5" rx="0.75" fill="#fb923c"/>
                  <rect x="16" y="11" width="1.5" height="3" rx="0.75" fill="#fb923c"/>
                </svg>
              </span>
              <span
                className="text-[12px] font-semibold tracking-wide whitespace-nowrap"
                style={{ color: "rgba(249,115,22,0.95)" }}
              >
                Chat
              </span>
              {/* Connection status dot */}
              <span className="relative flex shrink-0 w-2 h-2 ml-0.5">
                {wsConnected ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
                    <span className="relative inline-flex rounded-full w-2 h-2 bg-green-400" />
                  </>
                ) : (
                  <span className="relative inline-flex rounded-full w-2 h-2 bg-yellow-500" />
                )}
              </span>
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
      )}

      {/* ── Mobile backdrop ── */}
      {isMobileControlled && effectiveOpen && (
        <div
          className="fixed inset-0 z-[48] bg-black/60"
          style={{ backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)" }}
          onClick={handleClose}
          aria-hidden="true"
        />
      )}

      {/* ── Chat drawer ── */}
      {effectiveOpen && (
        <div
          role="dialog"
          aria-label="Community Chat"
          className={`fixed z-[49] flex flex-col overflow-hidden pointer-events-auto ${
            isMobileControlled
              ? "left-0 right-0 bottom-0 rounded-t-[24px]"
              : "rounded-[20px]"
          }`}
          style={
            isMobileControlled
              ? {
                  height: "85dvh",
                  background: "rgba(10,4,2,0.99)",
                  boxShadow: NM_DRAWER,
                  animation: "chatDrawerUpIn 0.30s cubic-bezier(0.34,1.2,0.64,1) forwards",
                }
              : {
                  /* --chat-drawer-bottom and --chat-drawer-max-h are defined in
                     globals.css using only existing layout tokens — no hardcoded px. */
                  bottom: "var(--chat-drawer-bottom)",
                  right: "var(--hud-inset)",
                  width: "min(92vw, 340px)",
                  height: "var(--chat-drawer-max-h)",
                  maxHeight: "520px",
                  background: "rgba(10,4,2,0.97)",
                  boxShadow: NM_DRAWER,
                  animation: "chatDrawerIn 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards",
                }
          }
        >
          {/* Mobile drag handle */}
          {isMobileControlled && (
            <div className="flex justify-center pt-2.5 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>
          )}

          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ borderBottom: "1px solid rgba(249,115,22,0.10)" }}
          >
            <div className="flex items-center gap-2">
              {/* <span className="text-base">💬</span> */}
              <div>
                <p className="text-orange-400 font-bold text-[13px] m-0">👥💬 Community Chat</p>
                <p className="text-white/30 text-[10px] m-0">
                  {wsConnected ? `${messages.length} messages` : "Connecting…"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {listenerCountProp !== null && listenerCountProp !== undefined && (
                <span
                  className="text-[11px] font-semibold tabular-nums"
                  style={{ color: "rgba(74,222,128,0.90)" }}
                >
                  {new Intl.NumberFormat("en-IN").format(listenerCountProp)}
                </span>
              )}
              <div
                className={`w-2 h-2 rounded-full ${wsConnected ? "bg-green-400 animate-pulse" : "bg-yellow-500"}`}
                style={wsConnected ? { boxShadow: "0 0 6px #4ade80" } : {}}
              />
              <button
                onClick={handleClose}
                aria-label="Close live chat"
                className="w-7 h-7 flex items-center justify-center rounded-full text-white/40
                           hover:text-white/80 hover:bg-white/10 transition-colors ml-1"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* First-time user notice toast — floats briefly for 3s on first chat open, then vanishes forever */}
          {showFirstTimeNotice && (
            <div
              className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full text-[11px] font-medium text-amber-200 bg-amber-950/95 border border-orange-500/40 backdrop-blur-md flex items-center gap-1.5 whitespace-nowrap shadow-2xl transition-all duration-300 pointer-events-none select-none"
              style={{
                boxShadow: "0 8px 24px rgba(0,0,0,0.85), 0 0 16px rgba(249,115,22,0.35)",
              }}
            >
              <span className="text-xs">🪔</span>
              <span>Only the latest 200 messages are retained in chat.</span>
            </div>
          )}

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

          {/* Name field */}
          <div className="px-3.5 pt-2 pb-1" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            {myName && !isEditingName ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-white/30">Chatting as</span>
                <button
                  onClick={() => { setNameInput(myName); setIsEditingName(true); }}
                  title="Click to change your name"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold
                             text-orange-400 transition-all hover:bg-orange-500/10"
                  style={{
                    background: "rgba(249,115,22,0.08)",
                    border: "1px solid rgba(249,115,22,0.25)",
                  }}
                >
                  {myName}
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5 opacity-60">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </button>
              </div>
            ) : (
              <input
                ref={nameInputRef}
                type="text"
                inputMode="text"
                enterKeyHint="done"
                placeholder="Your name (optional) — Enter to save, Esc to cancel"
                maxLength={40}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={handleNameKeyDown}
                onBlur={commitName}
                className="w-full rounded-lg px-2.5 py-1.5 text-white/70 outline-none border-none"
                style={{ background: "rgba(15,8,4,0.88)", boxShadow: NM_INPUT, fontSize: "16px" }}
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
                inputMode="text"
                enterKeyHint="send"
                placeholder="Jai Chhathi Maiya! 🪔"
                maxLength={200}
                value={inputText}
                onChange={(e) => { setInputText(e.target.value); setSendError(null); }}
                onKeyDown={handleKeyDown}
                className="flex-1 rounded-xl px-3 py-2 text-white outline-none border-none transition-all"
                style={{ background: "rgba(15,8,4,0.88)", boxShadow: NM_INPUT, fontSize: "16px" }}
              />
              <button
                onClick={handleSendWithNonce}
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
          </div>
        </div>
      )}
    </>
  );
}