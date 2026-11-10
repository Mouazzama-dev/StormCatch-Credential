"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/pickup", label: "Pickup desk (I-1)" },
  { href: "/dropoff", label: "Drop-off desk (I-2)" },
];

type Health = { pickup: boolean; dropoff: boolean } | null;

export function Nav() {
  const path = usePathname();
  const [health, setHealth] = useState<Health>(null);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      fetch("/api/health", { cache: "no-store" })
        .then((r) => r.json())
        .then((h: Health) => alive && setHealth(h))
        .catch(() => alive && setHealth({ pickup: false, dropoff: false }));
    poll();
    const t = setInterval(poll, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const led = (on: boolean | undefined) => `led ${on === undefined ? "" : on ? "on" : "off"}`;

  return (
    <nav className="nav">
      <Link href="/" className="brand">
        Stormcatch<span className="dot">.</span> interaction points
      </Link>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={`nav-link ${path === l.href ? "active" : ""}`}>
          {l.label}
        </Link>
      ))}
      <span className="nav-spacer" />
      <div className="health" title="Service health, checked every 10 s">
        <span><i className={led(health?.pickup)} /> pickup</span>
        <span><i className={led(health?.dropoff)} /> drop-off</span>
      </div>
    </nav>
  );
}
