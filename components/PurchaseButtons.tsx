import type { Manga } from "@/lib/manga/types";

type PurchaseButtonsProps = {
  manga: Manga;
};

export function PurchaseButtons({ manga }: PurchaseButtonsProps) {
  const searchText = encodeURIComponent(manga.title);
  const links = [
    {
      label: "Amazonで購入",
      href: manga.amazonUrl ?? `https://www.amazon.co.jp/s?k=${searchText}`,
      tone: "bg-stone-950 text-white hover:bg-stone-800",
    },
    {
      label: "楽天で購入",
      href:
        manga.rakutenUrl ??
        `https://books.rakuten.co.jp/search?sitem=${searchText}`,
      tone: "bg-red-700 text-white hover:bg-red-800",
    },
    {
      label: "レンタルで読む",
      href: manga.rentalUrl ?? `https://www.google.com/search?q=${searchText}+レンタル`,
      tone: "bg-white text-stone-900 ring-1 ring-stone-200 hover:bg-stone-100",
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className={`flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold transition ${link.tone}`}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
