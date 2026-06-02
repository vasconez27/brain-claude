import Link from "next/link";

export default function Home() {
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
          text-decoration: none;
          transition: background 0.2s, color 0.2s;
          margin-top: 44px;
        }
        .bc-enter:hover { background: #080808; color: #fff; }
      `}</style>
      <main
        className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: "#ffffff" }}
      >
        {/* BiG CREW circle mark — black on white */}
        <svg
          viewBox="0 0 400 400"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: 260, height: 260 }}
        >
          <circle cx="200" cy="200" r="184" fill="none" stroke="#080808" strokeWidth="13" />
          <text
            x="200" y="186"
            textAnchor="middle"
            fontFamily="'Bebas Neue','Arial Black',Impact,sans-serif"
            fontSize="138"
            fontWeight="900"
            fill="#080808"
            letterSpacing="0"
          >
            BiG
          </text>
          <line x1="62" y1="206" x2="338" y2="206" stroke="#080808" strokeWidth="6" />
          <text
            x="200" y="312"
            textAnchor="middle"
            fontFamily="'Bebas Neue','Arial Black',Impact,sans-serif"
            fontSize="92"
            fontWeight="900"
            fill="#080808"
            letterSpacing="7"
          >
            CREW
          </text>
        </svg>

        {/* Tagline */}
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

        <Link href="/bigcrew" className="bc-enter">
          ENTER
        </Link>
      </main>
    </>
  );
}
