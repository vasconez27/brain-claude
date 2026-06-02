import Link from "next/link";

export default function Home() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        .bc-font { font-family: 'Bebas Neue', 'Arial Black', Impact, sans-serif; }
        .bc-enter {
          display: inline-block;
          border: 2px solid #fff;
          color: #fff;
          letter-spacing: 0.25em;
          padding: 14px 48px;
          font-size: 14px;
          font-family: 'Bebas Neue', 'Arial Black', sans-serif;
          font-weight: 700;
          text-decoration: none;
          transition: background 0.2s, color 0.2s;
          margin-top: 48px;
        }
        .bc-enter:hover { background: #fff; color: #080808; }
      `}</style>
      <main
        className="min-h-screen flex flex-col items-center justify-center"
        style={{ background: "#080808" }}
      >
        {/* Circle Logo SVG */}
        <svg
          viewBox="0 0 400 400"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: 220, height: 220, marginBottom: 8 }}
        >
          <circle cx="200" cy="200" r="182" fill="none" stroke="white" strokeWidth="11" />
          <text
            x="200" y="178"
            textAnchor="middle"
            fontFamily="'Bebas Neue','Arial Black',Impact,sans-serif"
            fontSize="118"
            fontWeight="900"
            fill="white"
            letterSpacing="2"
          >
            BiG
          </text>
          <line x1="58" y1="198" x2="342" y2="198" stroke="white" strokeWidth="3" />
          <line x1="58" y1="206" x2="342" y2="206" stroke="white" strokeWidth="1.5" />
          <text
            x="200" y="296"
            textAnchor="middle"
            fontFamily="'Bebas Neue','Arial Black',Impact,sans-serif"
            fontSize="82"
            fontWeight="900"
            fill="white"
            letterSpacing="6"
          >
            CREW
          </text>
        </svg>

        {/* Tagline */}
        <p
          className="bc-font"
          style={{
            color: "#fff",
            fontSize: "22px",
            letterSpacing: "0.12em",
            marginTop: "24px",
            textAlign: "center",
          }}
        >
          On Time. On Point. On It.
        </p>

        <p
          style={{
            color: "#666",
            fontSize: "10px",
            letterSpacing: "0.3em",
            marginTop: "8px",
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
