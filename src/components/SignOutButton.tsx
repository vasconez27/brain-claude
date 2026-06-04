"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      style={{
        fontFamily: "'DM Mono','Courier New',monospace",
        fontSize: "10px",
        letterSpacing: "0.12em",
        color: "#6a6a6a",
        border: "1px solid #2c2c30",
        borderRadius: "6px",
        padding: "5px 10px",
        background: "transparent",
        cursor: "pointer",
        transition: "color 0.15s, border-color 0.15s",
      }}
      onMouseEnter={e => {
        (e.target as HTMLButtonElement).style.color = "#f87171";
        (e.target as HTMLButtonElement).style.borderColor = "#f87171";
      }}
      onMouseLeave={e => {
        (e.target as HTMLButtonElement).style.color = "#6a6a6a";
        (e.target as HTMLButtonElement).style.borderColor = "#2c2c30";
      }}
    >
      LOG OUT
    </button>
  );
}
