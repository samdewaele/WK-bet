"use client";

import { useState, useEffect } from "react";

const TOURNAMENT_START = "2026-06-11T21:00:00Z";

type Props = {
  /** ISO string target date. Defaults to tournament start. */
  target?: string;
  /** Label shown before the countdown digits. */
  label?: string;
  /** Message shown once the target has passed. */
  finishedMessage?: string;
  className?: string;
};

export default function CountdownTimer({
  target = TOURNAMENT_START,
  label = "Kicks off in",
  finishedMessage = "Tournament has started! 🎉",
  className = "",
}: Props) {
  const [timeLeft, setTimeLeft] = useState<{ days: number; hours: number; minutes: number; seconds: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const targetMs = new Date(target).getTime();
    function calc() {
      const diff = targetMs - Date.now();
      if (diff <= 0) { setTimeLeft(null); return; }
      setTimeLeft({
        days:    Math.floor(diff / 86400000),
        hours:   Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      });
    }
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!mounted) return null;
  if (!timeLeft) return <span className={`text-green-400 font-semibold ${className}`}>{finishedMessage}</span>;

  return (
    <div className={`flex items-center gap-3 flex-wrap ${className}`}>
      <span className="text-gray-400 text-sm">{label}</span>
      {[
        { v: timeLeft.days,    label: "days" },
        { v: timeLeft.hours,   label: "hrs"  },
        { v: timeLeft.minutes, label: "min"  },
        { v: timeLeft.seconds, label: "sec"  },
      ].map(({ v, label: unit }) => (
        <div key={unit} className="flex items-baseline gap-0.5">
          <span className="text-2xl font-bold text-amber-400 tabular-nums">{String(v).padStart(2, "0")}</span>
          <span className="text-xs text-gray-500">{unit}</span>
        </div>
      ))}
    </div>
  );
}
