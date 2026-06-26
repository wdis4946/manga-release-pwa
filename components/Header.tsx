import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="min-w-0">
          <p className="text-lg font-bold tracking-normal text-stone-950">
            Manga Release
          </p>
          <p className="text-xs text-stone-500">新刊通知・漫画探索</p>
        </Link>
        <nav className="flex items-center gap-2 text-sm font-medium text-stone-600">
          <Link className="rounded-md px-2 py-2 hover:bg-stone-200" href="/">
            探す
          </Link>
          <span className="rounded-md px-2 py-2 text-stone-400">お気に入り</span>
          <span className="rounded-md px-2 py-2 text-stone-400">設定</span>
        </nav>
      </div>
    </header>
  );
}
