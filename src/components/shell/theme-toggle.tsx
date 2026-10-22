"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
    setDark(next);
  };
  return { dark, toggle };
}

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button onClick={toggle} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-2 hover:bg-hover cursor-pointer" aria-label="Toggle theme">
      {dark ? <Sun className="size-4 text-fg-3" /> : <Moon className="size-4 text-fg-3" />}
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}
