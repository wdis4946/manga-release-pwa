"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const isAdminPage = pathname.startsWith("/admin");

  useEffect(() => {
    if (isAdminPage) {
      return;
    }

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

    function handleModalOpen() {
      setIsHidden(false);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("public-gallery-modal-open", handleModalOpen);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("public-gallery-modal-open", handleModalOpen);
    };
  }, [isAdminPage]);

  if (isAdminPage) {
    return null;
  }

  return (
    <header
      className={`font-yomogi sticky top-0 z-20 border-b border-stone-200 bg-white/95 px-3 py-3 backdrop-blur transition-transform duration-300 sm:px-5 ${
        isHidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <SearchHeader tags={tags} authors={authors} />
    </header>
  );
}
