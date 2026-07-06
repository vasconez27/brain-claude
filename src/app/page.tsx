"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  function enter() {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => router.push("/login"), 1150);
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

        /* dark mode — flip the ENTER button + logo to light */
        .dark .bc-enter { border-color: #ededed; color: #ededed; }
        .dark .bc-enter:hover { background: #ededed; color: #0a0a0a; letter-spacing: 0.34em; }
        .dark .bc-logo { filter: invert(1); }

        /* landing content leaving */
        .bc-stage { transition: opacity 0.4s ease, transform 0.6s cubic-bezier(0.6,0,0.2,1); }
        .bc-stage.leaving { opacity: 0; transform: scale(1.18); }

        /* brand-red iris expanding from the logo center */
        .bc-iris {
          position: fixed; left: 50%; top: 50%;
          width: 14px; height: 14px; border-radius: 50%;
          background: #ce2c1f; /* matches the B. mark's background exactly */
          transform: translate(-50%, -50%) scale(0);
          z-index: 998; pointer-events: none;
        }
        .bc-iris.go { animation: bcIris 0.7s cubic-bezier(0.76,0,0.24,1) forwards; }
        @keyframes bcIris {
          from { transform: translate(-50%,-50%) scale(0); }
          to   { transform: translate(-50%,-50%) scale(360); }
        }

        /* white logo bridge on the black field */
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
        .bc-bridge img {
          width: 220px; height: 220px; object-fit: contain;
          /* the mark's own red background blends into the iris — no filter */
        }
        .bc-dots { display: flex; gap: 7px; margin-top: 30px; }
        .bc-dots span {
          width: 7px; height: 7px; border-radius: 50%; background: #0a0a0a;
          animation: bcPulse 1s infinite ease-in-out;
        }
        .bc-dots span:nth-child(2) { animation-delay: 0.15s; }
        .bc-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes bcPulse { 0%,100%{opacity:0.25;transform:scale(0.8);} 50%{opacity:1;transform:scale(1);} }
      `}</style>

      <main
        className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: "var(--background)", overflow: "hidden" }}
      >
        <div className={`bc-stage flex flex-col items-center ${leaving ? "leaving" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="bc-logo"
            src="/bigcrewlogo.png"
            alt="BigCrew NY"
            width={280}
            height={280}
            style={{ objectFit: "contain" }}
          />

          <p
            style={{
              fontFamily: "'Bebas Neue','Arial Black',sans-serif",
              color: "var(--foreground)",
              fontSize: "26px",
              letterSpacing: "0.1em",
              marginTop: "28px",
              textAlign: "center",
            }}
          >
            On Time. On Point. On It.
          </p>

          <p
            style={{
              color: "#888",
              fontSize: "10px",
              letterSpacing: "0.32em",
              marginTop: "10px",
              textTransform: "uppercase",
            }}
          >
            Crew Management System
          </p>

          <button className="bc-enter" onClick={enter}>
            ENTER
          </button>
        </div>

        {/* transition layers */}
        <div className={`bc-iris ${leaving ? "go" : ""}`} />
        <div className={`bc-bridge ${leaving ? "go" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/b-brand.webp" alt="" />
          <div className="bc-dots"><span /><span /><span /></div>
        </div>
      </main>
    </>
  );
}
