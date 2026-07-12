"use client";

import { useEffect, useRef, useState } from "react";
import { SearchHeader } from "./SearchHeader";

type Suggestion = {
  id: string;
  name: string;
};

type AutoHideHeaderProps = {
  tags: Suggestion[];
  authors: Suggestion[];
};

export function AutoHideHeader({ tags, authors }: AutoHideHeaderProps) {
  const [isHidden, setIsHidden] = useState(false);
  const lastScrollYRef = useRef(0);

  useEffect(() => {
    lastScrollYRef.current = window.scrollY;

    function handleScroll() {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollYRef.current;

      if (currentScrollY < 16) {
        setIsHidden(false);
      } else if (delta > 8) {
        setIsHidden(true);
      } else if (delta < -8) {
        setIsHidden(false);
      }

      lastScrollYRef.current = currentScrollY;
    }

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-20 border-b border-stone-200 bg-white/95 px-3 py-3 backdrop-blur transition-transform duration-300 sm:px-5 ${
        isHidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <SearchHeader tags={tags} authors={authors} />
    </header>
  );
}
