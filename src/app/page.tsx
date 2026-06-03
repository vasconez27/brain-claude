"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const COLS = 6;
const ROWS = 9;

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

        /* black steel deck grid */
        .bc-deck {
          position: fixed; inset: 0; z-index: 998;
          display: grid;
          grid-template-columns: repeat(${COLS}, 1fr);
          grid-template-rows: repeat(${ROWS}, 1fr);
          perspective: 900px;
          pointer-events: none;
        }
        .bc-tile {
          position: relative;
          transform-origin: top center;
          transform: rotateX(-100deg);
          opacity: 0;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0) 18%),
            linear-gradient(135deg, #1b1d20 0%, #000000 58%, #0c0e10 100%);
          border: 1px solid #000;
          box-shadow: inset 0 0 18px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05);
        }
        .bc-deck.go .bc-tile {
          animation: bcFlip 0.5s cubic-bezier(0.3,1.3,0.5,1) forwards;
        }
        @keyframes bcFlip {
          0%   { transform: rotateX(-100deg); opacity: 0; }
          60%  { opacity: 1; }
          100% { transform: rotateX(0deg); opacity: 1; }
        }
        /* bolt heads, top-left + top-right of each tile */
        .bc-tile::before, .bc-tile::after {
          content: ""; position: absolute; top: 8px; width: 5px; height: 5px; border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #5a5f66, #0a0b0d);
        }
        .bc-tile::before { left: 8px; }
        .bc-tile::after  { right: 8px; }

        /* logo bridge */
        .bc-bridge {
          position: fixed; inset: 0; z-index: 999;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          opacity: 0; pointer-events: none;
        }
        .bc-bridge.go { animation: bcBridge 0.9s ease 0.78s forwards; }
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

        {/* black steel deck flipping into place, diagonal sweep */}
        <div className={`bc-deck ${leaving ? "go" : ""}`}>
          {Array.from({ length: COLS * ROWS }).map((_, i) => {
            const row = Math.floor(i / COLS);
            const col = i % COLS;
            return (
              <div
                key={i}
                className="bc-tile"
                style={{ animationDelay: `${(row + col) * 0.05}s` }}
              />
            );
          })}
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
