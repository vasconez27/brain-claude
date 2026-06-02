"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  function enter() {
    if (leaving) return;
    setLeaving(true);
    // let the circle expand, then navigate into the app
    setTimeout(() => router.push("/bigcrew"), 620);
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
          transition: background 0.2s, color 0.2s;
          margin-top: 44px;
        }
        .bc-enter:hover { background: #080808; color: #fff; }
        .bc-stage { transition: opacity 0.4s ease, transform 0.5s ease; }
        .bc-stage.leaving { opacity: 0; transform: scale(0.94); }
        .bc-wipe {
          position: fixed;
          left: 50%; top: 50%;
          width: 10px; height: 10px;
          border-radius: 50%;
          background: #080808;
          transform: translate(-50%, -50%) scale(0);
          z-index: 999;
          pointer-events: none;
        }
        .bc-wipe.go {
          animation: bcExpand 0.62s cubic-bezier(0.7, 0, 0.84, 0) forwards;
        }
        @keyframes bcExpand {
          from { transform: translate(-50%, -50%) scale(0); }
          to   { transform: translate(-50%, -50%) scale(300); }
        }
      `}</style>

      <main
        className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: "#ffffff", overflow: "hidden" }}
      >
        <div className={`bc-stage flex flex-col items-center ${leaving ? "leaving" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bigcrewlogo.png"
            alt="BigCrew NY"
            width={280}
            height={280}
            style={{ objectFit: "contain" }}
          />

          <p
            style={{
              fontFamily: "'Bebas Neue','Arial Black',sans-serif",
              color: "#080808",
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

        <div className={`bc-wipe ${leaving ? "go" : ""}`} />
      </main>
    </>
  );
}
