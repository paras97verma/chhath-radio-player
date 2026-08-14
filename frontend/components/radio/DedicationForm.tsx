"use client";

/**
 * DedicationForm — Modal for dedicating the currently playing song.
 *
 * Stores dedications in localStorage (max 50, most recent first).
 * Calls onSubmit(dedication) so parent can add it to the ticker.
 */

import { useState, useRef, useEffect } from "react";

export interface Dedication {
  id: string;
  to: string;
  message: string;
  songTitle: string;
  timestamp: number;
}

const STORAGE_KEY = "chhath_dedications_v1";
const MAX_STORED = 50;

export function loadDedications(): Dedication[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveDedication(d: Dedication) {
  try {
    const existing = loadDedications();
    const updated = [d, ...existing].slice(0, MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
}

interface Props {
  songTitle: string;
  onClose: () => void;
  onSubmit: (d: Dedication) => void;
}

export default function DedicationForm({ songTitle, onClose, onSubmit }: Props) {
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const toRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    toRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim()) return;

    const dedication: Dedication = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      to: to.trim().slice(0, 60),
      message: message.trim().slice(0, 80),
      songTitle,
      timestamp: Date.now(),
    };

    saveDedication(dedication);
    onSubmit(dedication);
    setSubmitted(true);

    setTimeout(onClose, 2000);
  };

  return (
    <>
      <style>{`
        @keyframes dedicationModalIn {
          0%   { transform: scale(0.92) translateY(12px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 60,
          background: "rgba(0,0,0,0.65)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Dedicate this song"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 61,
          width: "min(92vw, 380px)",
          background: "rgba(10,4,2,0.97)",
          border: "1px solid rgba(249,115,22,0.3)",
          borderRadius: 20,
          padding: "24px 24px 20px",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(249,115,22,0.08)",
          animation: "dedicationModalIn 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards",
        }}
      >
        {submitted ? (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🪔</div>
            <p style={{ color: "#fb923c", fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
              Dedication sent!
            </p>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
              Your dedication will appear in the ticker
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
              <div>
                <p style={{ color: "#fb923c", fontWeight: 700, fontSize: 15, marginBottom: 3 }}>
                  🪔 Dedicate this song
                </p>
                <p style={{
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 11,
                  maxWidth: 260,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {songTitle}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,0.3)",
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                  padding: 4,
                }}
              >
                ✕
              </button>
            </div>

            {/* To field */}
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
                DEDICATED TO *
              </span>
              <input
                ref={toRef}
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="e.g. Maa, Dadi, my family…"
                maxLength={60}
                required
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(249,115,22,0.25)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  color: "#fff",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => { e.target.style.borderColor = "rgba(249,115,22,0.6)"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(249,115,22,0.25)"; }}
              />
            </label>

            {/* Message field */}
            <label style={{ display: "block", marginBottom: 20 }}>
              <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
                MESSAGE (optional)
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="A short message of love or prayer…"
                maxLength={80}
                rows={2}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(249,115,22,0.25)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  color: "#fff",
                  fontSize: 13,
                  outline: "none",
                  resize: "none",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => { e.target.style.borderColor = "rgba(249,115,22,0.6)"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(249,115,22,0.25)"; }}
              />
              <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, float: "right", marginTop: 3 }}>
                {message.length}/80
              </span>
            </label>

            {/* Submit */}
            <button
              type="submit"
              disabled={!to.trim()}
              style={{
                width: "100%",
                padding: "11px 0",
                borderRadius: 12,
                background: to.trim()
                  ? "linear-gradient(135deg, #fb923c, #ea580c)"
                  : "rgba(255,255,255,0.06)",
                border: "none",
                color: to.trim() ? "#fff" : "rgba(255,255,255,0.3)",
                fontWeight: 700,
                fontSize: 14,
                cursor: to.trim() ? "pointer" : "not-allowed",
                transition: "background 0.2s",
                boxShadow: to.trim() ? "0 0 20px rgba(249,115,22,0.3)" : "none",
              }}
            >
              🪔 Send Dedication
            </button>
          </form>
        )}
      </div>
    </>
  );
}