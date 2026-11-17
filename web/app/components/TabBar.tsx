"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home" },
  { href: "/library", label: "Library" },
  { href: "/search", label: "Search" },
  { href: "/upload", label: "Upload" },
];

export default function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={path === t.href ? "tab active" : "tab"}
          aria-current={path === t.href ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
