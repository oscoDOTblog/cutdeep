"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home" },
  { href: "/library", label: "Library" },
  { href: "/search", label: "Search" },
  { href: "/upload", label: "Upload" },
  { href: "/settings", label: "Settings" },
];

export default function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map(({ href, label }) => {
        const current = path === href ? "page" : path.startsWith(`${href}/`) ? "location" : undefined;
        return (
          <Link key={href} href={href} className={current ? "tab active" : "tab"} aria-current={current}>
            {current && <span className="tab-marker" aria-hidden="true">◆ </span>}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
