"use client";

import { useState } from "react";

export function RecordActions({ shareUrl, imagePath }: { shareUrl: string; imagePath: string }) {
  const [label, setLabel] = useState("Copy link");
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn-2"
        onClick={() =>
          navigator.clipboard.writeText(shareUrl).then(
            () => {
              setLabel("Link copied");
              setTimeout(() => setLabel("Copy link"), 1600);
            },
            () => setLabel("Copy blocked: use the address bar"),
          )
        }
      >
        <span aria-live="polite">{label}</span>
      </button>
      <a className="btn btn-sm" href={imagePath} download>
        Save as image
      </a>
    </div>
  );
}
