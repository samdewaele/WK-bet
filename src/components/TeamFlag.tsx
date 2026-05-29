"use client";

import { useState } from "react";
import { flagToUrl, flagToCode } from "@/lib/flag-url";

export default function TeamFlag({ flag, name, size = 28 }: { flag: string; name?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const url = flagToUrl(flag);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name ?? flag}
        width={size}
        height={Math.round(size * 0.75)}
        className="object-cover rounded-sm inline-block shrink-0"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  // Fallback: country code badge, readable on all platforms
  const code = flagToCode(flag);
  return (
    <span
      className="inline-flex items-center justify-center bg-gray-600 text-white rounded font-bold shrink-0"
      style={{ width: size, height: Math.round(size * 0.75), fontSize: Math.round(size * 0.38) }}
    >
      {code !== '??' ? code : '??'}
    </span>
  );
}
