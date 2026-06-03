"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const LAYERS = 7;

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

        /* stacked black steel deck layers */
        .bc-deck {
          position: fixed; inset: 0; z-index: 998;
          display: flex; flex-direction: column;
          pointer-events: none;
        }
        .bc-layer {
          flex: 1;
          position: relative;
          opacity: 0;
          /* black steel deck with triangulated truss bracing */
          background-color: #050506;
          background-image:
            linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0) 22%, rgba(0,0,0,0.6)),
            repeating-linear-gradient(45deg, transparent 0 20px, rgba(150,154,160,0.45) 20px 22px),
            repeating-linear-gradient(-45deg, transparent 0 20px, rgba(150,154,160,0.45) 20px 22px);
          border-top: 3px solid #2b2e33;
          border-bottom: 4px solid #000;
          box-shadow: inset 0 0 40px rgba(0,0,0,0.85);
        }
        .bc-deck.go .bc-layer {
          animation: bcSlide 0.5s cubic-bezier(0.32,1.25,0.5,1) forwards;
        }
        .bc-layer.l { transform: translateX(-115%); }
        .bc-layer.r { transform: translateX(115%); }
        @keyframes bcSlide {
          0%   { opacity: 0.5; }
          70%  { opacity: 1; }
          100% { transform: translateX(0); opacity: 1; }
        }
        /* bolt heads on the rails */
        .bc-layer::before, .bc-layer::after {
          content: ""; position: absolute; top: 7px; width: 6px; height: 6px; border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #7a7f86, #0a0b0d);
          box-shadow: 22px 0 0 #0a0b0d33;
        }
        .bc-layer::before { left: 10px; }
        .bc-layer::after  { right: 10px; }

        /* logo bridge */
        .bc-bridge {
          position: fixed; inset: 0; z-index: 999;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          opacity: 0; pointer-events: none;
        }
        .bc-bridge.go { animation: bcBridge 0.9s ease 0.72s forwards; }
        @keyframes bcBridge {
          0%   { opacity: 0; transform: scale(0.8) translateY(8px); }
          45%  { opacity: 1; transform: scale(1) translateY(0); }
          100% { opacity: 1; transform: scale(1.04); }
        }
        .bc-bridge img { width: 210px; height: 210px; object-fit: contain; filter: invert(1); }
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

        {/* black steel deck layers sliding in and stacking (bottom-up) */}
        <div className={`bc-deck ${leaving ? "go" : ""}`}>
          {Array.from({ length: LAYERS }).map((_, i) => (
            <div
              key={i}
              className={`bc-layer ${i % 2 === 0 ? "l" : "r"}`}
              style={{ animationDelay: `${(LAYERS - 1 - i) * 0.08}s` }}
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
