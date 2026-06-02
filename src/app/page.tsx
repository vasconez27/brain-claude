import Link from "next/link";
import Image from "next/image";

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
        <Image
          src="/bigcrewlogo.png"
          alt="BigCrew NY"
          width={280}
          height={280}
          priority
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

        <Link href="/bigcrew" className="bc-enter">
          ENTER
        </Link>
      </main>
    </>
  );
}
