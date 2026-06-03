"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PLANKS = 8;

export default function Home() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  function enter() {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => router.push("/bigcrew"), 1500);
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');

        .bc-enter {
          display: inline-block;
          border: 2px solid #080808;
          color: #080808;
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
        .bc-enter:hover { background: #080808; color: #fff; letter-spacing: 0.34em; }

        .bc-stage { transition: opacity 0.35s ease, transform 0.5s cubic-bezier(0.6,0,0.2,1); }
        .bc-stage.leaving { opacity: 0; transform: scale(1.12); }

        /* steel deck assembly */
        .bc-deck {
          position: fixed; inset: 0; z-index: 998;
          display: flex; pointer-events: none;
        }
        .bc-plank {
          flex: 1;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0) 12%),
            repeating-linear-gradient(180deg, #34383e 0 38px, #2c3036 38px 40px),
            linear-gradient(135deg, #3a3e44 0%, #23262b 55%, #2b2f34 100%);
          border-right: 2px solid #14161a;
          border-left: 1px solid rgba(255,255,255,0.06);
          box-shadow: inset 0 0 22px rgba(0,0,0,0.55);
          transform: translateY(105%);
          opacity: 0;
        }
        .bc-deck.go .bc-plank {
          animation: bcSlam 0.5s cubic-bezier(0.34,1.4,0.5,1) forwards;
        }
        @keyframes bcSlam {
          0%   { transform: translateY(105%); opacity: 0.4; }
          70%  { opacity: 1; }
          85%  { transform: translateY(-2.5%); }
          100% { transform: translateY(0); opacity: 1; }
        }
        /* bolt heads at the corners of each plank for that deck-hardware look */
        .bc-plank::before, .bc-plank::after {
          content: ""; position: absolute; width: 6px; height: 6px; border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #6a6f76, #1a1c20);
          left: 7px;
        }
        .bc-plank::before { top: 12px; }
        .bc-plank::after  { bottom: 12px; }

        /* logo bridge on assembled steel */
        .bc-bridge {
          position: fixed; inset: 0; z-index: 999;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          opacity: 0; pointer-events: none;
        }
        .bc-bridge.go { animation: bcBridge 0.9s ease 0.62s forwards; }
        @keyframes bcBridge {
          0%   { opacity: 0; transform: scale(0.8) translateY(8px); }
          45%  { opacity: 1; transform: scale(1) translateY(0); }
          100% { opacity: 1; transform: scale(1.04); }
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
        style={{ background: "#ffffff", overflow: "hidden" }}
      >
        <div className={`bc-stage flex flex-col items-center ${leaving ? "leaving" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bigcrewlogo.png" alt="BigCrew NY" width={280} height={280} style={{ objectFit: "contain" }} />
          <p style={{ fontFamily: "'Bebas Neue','Arial Black',sans-serif", color: "#080808", fontSize: "26px", letterSpacing: "0.1em", marginTop: "28px", textAlign: "center" }}>
            On Time. On Point. On It.
          </p>
          <p style={{ color: "#888", fontSize: "10px", letterSpacing: "0.32em", marginTop: "10px", textTransform: "uppercase" }}>
            Crew Management System
          </p>
          <button className="bc-enter" onClick={enter}>ENTER</button>
        </div>

        {/* steel deck planks slamming into place */}
        <div className={`bc-deck ${leaving ? "go" : ""}`}>
          {Array.from({ length: PLANKS }).map((_, i) => (
            <div
              key={i}
              className="bc-plank"
              style={{ animationDelay: `${i * 0.06}s`, position: "relative" }}
            />
          ))}
        </div>

        {/* logo bridge */}
        <div className={`bc-bridge ${leaving ? "go" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bigcrewlogo.png" alt="" />
          <div className="bc-dots"><span /><span /><span /></div>
        </div>
      </main>
    </>
  );
}
