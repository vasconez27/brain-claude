"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [dark, setDark] = useState(false);

  // Share the same theme preference as the BigCrew app.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("bigcrew_theme");
      if (saved === "dark") setDark(true);
    } catch {}
  }, []);

  function toggleTheme() {
    setDark((d) => {
      const next = !d;
      try { localStorage.setItem("bigcrew_theme", next ? "dark" : "light"); } catch {}
      return next;
    });
  }

  function enter() {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => router.push("/bigcrew"), 1150);
  }

  // Landing palette flips with the theme.
  const bg = dark ? "#0c0c0d" : "#ffffff";
  const fg = dark ? "#f2f2f2" : "#080808";
  const sub = dark ? "#8a8a8a" : "#888888";
  const logoFilter = dark ? "invert(1)" : "none";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');

        .bc-enter {
          display: inline-block;
          border: 2px solid var(--fg);
          color: var(--fg);
          letter-spacing: 0.28em;
          padding: 15px 56px;
          font-size: 15px;
          font-family: 'Bebas Neue', 'Arial Black', sans-serif;
          font-weight: 700;
          background: transparent;
          cursor: pointer;
          transition: background 0.2s, color 0.2s, letter-spacing 0.2s;
          margin-top: 44px;
        }
        .bc-enter:hover { background: var(--fg); color: var(--bg); letter-spacing: 0.34em; }

        /* on/off slider switch */
        .bc-switch {
          position: fixed; right: 18px; top: 18px; z-index: 50;
          width: 62px; height: 32px; border-radius: 999px;
          border: 2px solid var(--fg); background: transparent;
          cursor: pointer; padding: 0; display: block;
          transition: background 0.25s ease;
        }
        .bc-switch.on { background: var(--fg); }
        .bc-knob {
          position: absolute; top: 3px; left: 3px;
          width: 22px; height: 22px; border-radius: 50%;
          background: var(--fg);
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; color: var(--bg);
          transition: transform 0.25s cubic-bezier(0.4,0,0.2,1), background 0.25s ease, color 0.25s ease;
        }
        .bc-switch.on .bc-knob { transform: translateX(30px); background: var(--bg); color: var(--fg); }

        /* landing content leaving */
        .bc-stage { transition: opacity 0.4s ease, transform 0.6s cubic-bezier(0.6,0,0.2,1); }
        .bc-stage.leaving { opacity: 0; transform: scale(1.18); }

        /* black iris expanding from center */
        .bc-iris {
          position: fixed; left: 50%; top: 50%;
          width: 14px; height: 14px; border-radius: 50%;
          background: #080808;
          transform: translate(-50%, -50%) scale(0);
          z-index: 998; pointer-events: none;
        }
        .bc-iris.go { animation: bcIris 0.7s cubic-bezier(0.76,0,0.24,1) forwards; }
        @keyframes bcIris {
          from { transform: translate(-50%,-50%) scale(0); }
          to   { transform: translate(-50%,-50%) scale(360); }
        }

        /* white logo on black loading screen */
        .bc-bridge {
          position: fixed; inset: 0; z-index: 999;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          opacity: 0; pointer-events: none;
        }
        .bc-bridge.go { animation: bcBridge 0.85s ease 0.42s forwards; }
        @keyframes bcBridge {
          0%   { opacity: 0; transform: scale(0.82); }
          35%  { opacity: 1; transform: scale(1); }
          100% { opacity: 1; transform: scale(1.05); }
        }
        .bc-bridge img { width: 200px; height: 200px; object-fit: contain; filter: invert(1); }
        .bc-dots { display: flex; gap: 7px; margin-top: 30px; }
        .bc-dots span { width: 7px; height: 7px; border-radius: 50%; background: #fff; animation: bcPulse 1s infinite ease-in-out; }
        .bc-dots span:nth-child(2) { animation-delay: 0.15s; }
        .bc-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes bcPulse { 0%,100%{opacity:0.25;transform:scale(0.8);} 50%{opacity:1;transform:scale(1);} }
      `}</style>

      <main
        className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: bg, overflow: "hidden", transition: "background 0.3s ease", ["--fg" as string]: fg, ["--bg" as string]: bg }}
      >
        <button className={`bc-switch ${dark ? "on" : ""}`} onClick={toggleTheme} title={dark ? "Switch to light mode" : "Switch to dark mode"} aria-label="Toggle dark mode">
          <span className="bc-knob">{dark ? "☀" : "☾"}</span>
        </button>

        <div className={`bc-stage flex flex-col items-center ${leaving ? "leaving" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bigcrewlogo.png" alt="BigCrew NY" width={280} height={280} style={{ objectFit: "contain", filter: logoFilter, transition: "filter 0.3s ease" }} />
          <p style={{ fontFamily: "'Bebas Neue','Arial Black',sans-serif", color: fg, fontSize: "26px", letterSpacing: "0.1em", marginTop: "28px", textAlign: "center", transition: "color 0.3s ease" }}>
            On Time. On Point. On It.
          </p>
          <p style={{ color: sub, fontSize: "10px", letterSpacing: "0.32em", marginTop: "10px", textTransform: "uppercase" }}>
            Crew Management System
          </p>
          <button className="bc-enter" onClick={enter}>ENTER</button>
        </div>

        <div className={`bc-iris ${leaving ? "go" : ""}`} />
        <div className={`bc-bridge ${leaving ? "go" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bigcrewlogo.png" alt="" />
          <div className="bc-dots"><span /><span /><span /></div>
        </div>
      </main>
    </>
  );
}
