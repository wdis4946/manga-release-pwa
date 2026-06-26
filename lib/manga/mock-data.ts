import type { Manga } from "./types";

// Phase 1 uses static mock data. Keep the shape close to the future API response
// so the UI can later switch to Supabase-backed data with minimal component churn.
export const mangaList: Manga[] = [
  {
    id: "skyline-alchemist",
    title: "スカイラインの錬金術師",
    authorName: "青井ミナト",
    description:
      "空中都市を巡る若き錬金術師が、失われた金属生命体の謎を追う冒険譚。",
    coverImageUrl:
      "https://placehold.co/420x640/1f2937/f8fafc/png?text=Skyline%0AAlchemist",
    genres: ["ファンタジー", "冒険", "バトル"],
    popularityScore: 98,
    latestVolumeNumber: 12,
    nextReleaseDate: "2026-07-03",
    amazonUrl: "https://www.amazon.co.jp/s?k=スカイラインの錬金術師",
    rakutenUrl:
      "https://books.rakuten.co.jp/search?sitem=スカイラインの錬金術師",
    rentalUrl: "https://www.google.com/search?q=スカイラインの錬金術師+レンタル",
  },
  {
    id: "midnight-bento-club",
    title: "真夜中弁当クラブ",
    authorName: "春野コウ",
    description:
      "終電後の商店街で出会った高校生たちが、夜食づくりを通じて少しずつ居場所を見つけていく。",
    coverImageUrl:
      "https://placehold.co/420x560/7c2d12/fff7ed/png?text=Midnight%0ABento",
    genres: ["日常", "料理", "青春"],
    popularityScore: 86,
    latestVolumeNumber: 5,
    nextReleaseDate: "2026-08-10",
    amazonUrl: "https://www.amazon.co.jp/s?k=真夜中弁当クラブ",
    rakutenUrl: "https://books.rakuten.co.jp/search?sitem=真夜中弁当クラブ",
    rentalUrl: "https://www.google.com/search?q=真夜中弁当クラブ+レンタル",
  },
  {
    id: "quantum-detective-aya",
    title: "量子探偵アヤ",
    authorName: "黒瀬レン",
    description:
      "観測するたびに真実が変わる事件を、天才探偵アヤが論理と直感で解き明かす。",
    coverImageUrl:
      "https://placehold.co/420x700/0f766e/ecfeff/png?text=Quantum%0ADetective",
    genres: ["ミステリー", "SF"],
    popularityScore: 91,
    latestVolumeNumber: 8,
    nextReleaseDate: "2026-06-30",
    amazonUrl: "https://www.amazon.co.jp/s?k=量子探偵アヤ",
    rakutenUrl: "https://books.rakuten.co.jp/search?sitem=量子探偵アヤ",
    rentalUrl: "https://www.google.com/search?q=量子探偵アヤ+レンタル",
  },
  {
    id: "dragon-post-office",
    title: "竜の郵便局",
    authorName: "青井ミナト",
    description:
      "山脈を越えて手紙を届ける新人配達員と小さな竜の、やさしい旅の記録。",
    coverImageUrl:
      "https://placehold.co/420x620/365314/f7fee7/png?text=Dragon%0APost",
    genres: ["ファンタジー", "日常"],
    popularityScore: 79,
    latestVolumeNumber: 3,
    nextReleaseDate: "2026-07-25",
    amazonUrl: "https://www.amazon.co.jp/s?k=竜の郵便局",
    rakutenUrl: "https://books.rakuten.co.jp/search?sitem=竜の郵便局",
    rentalUrl: "https://www.google.com/search?q=竜の郵便局+レンタル",
  },
  {
    id: "after-school-orbit",
    title: "放課後オービット",
    authorName: "夏目ユイ",
    description:
      "廃部寸前の天文部が、人工衛星コンテストを目指して走り出す理系青春ストーリー。",
    coverImageUrl:
      "https://placehold.co/420x590/1d4ed8/eff6ff/png?text=After%20School%0AOrbit",
    genres: ["青春", "SF", "部活"],
    popularityScore: 74,
    latestVolumeNumber: 6,
    nextReleaseDate: "2026-09-12",
    amazonUrl: "https://www.amazon.co.jp/s?k=放課後オービット",
    rakutenUrl: "https://books.rakuten.co.jp/search?sitem=放課後オービット",
    rentalUrl: "https://www.google.com/search?q=放課後オービット+レンタル",
  },
  {
    id: "steel-heart-runner",
    title: "鋼鉄心臓ランナー",
    authorName: "橘サトル",
    description:
      "義体ランナーたちが巨大企業主催の地下レースで自由を賭けて競う近未来アクション。",
    coverImageUrl:
      "https://placehold.co/420x680/991b1b/fef2f2/png?text=Steel%20Heart%0ARunner",
    genres: ["バトル", "SF", "スポーツ"],
    popularityScore: 88,
    latestVolumeNumber: 10,
    nextReleaseDate: "2026-07-01",
    amazonUrl: "https://www.amazon.co.jp/s?k=鋼鉄心臓ランナー",
    rakutenUrl: "https://books.rakuten.co.jp/search?sitem=鋼鉄心臓ランナー",
    rentalUrl: "https://www.google.com/search?q=鋼鉄心臓ランナー+レンタル",
  },
  {
    id: "paper-moon-cafe",
    title: "ペーパームーン喫茶店",
    authorName: "森町ナナ",
    description:
      "月明かりの夜だけ開く喫茶店で、悩みを抱えた客たちが不思議な一杯に出会う。",
    coverImageUrl:
      "https://placehold.co/420x540/854d0e/fffbeb/png?text=Paper%20Moon%0ACafe",
    genres: ["日常", "ヒューマン", "ファンタジー"],
    popularityScore: 83,
    latestVolumeNumber: 4,
    nextReleaseDate: "2026-07-18",
    amazonUrl: "https://www.amazon.co.jp/s?k=ペーパームーン喫茶店",
    rakutenUrl: "https://books.rakuten.co.jp/search?sitem=ペーパームーン喫茶店",
    rentalUrl: "https://www.google.com/search?q=ペーパームーン喫茶店+レンタル",
  },
  {
    id: "red-thread-terminal",
    title: "赤い糸ターミナル",
    authorName: "夏目ユイ",
    description:
      "運命の相手が電光掲示板に表示される駅で、恋と選択に揺れる群像劇。",
    coverImageUrl:
      "https://placehold.co/420x610/be123c/fff1f2/png?text=Red%20Thread%0ATerminal",
    genres: ["恋愛", "青春"],
    popularityScore: 81,
    latestVolumeNumber: 7,
    nextReleaseDate: "2026-08-02",
    amazonUrl: "https://www.amazon.co.jp/s?k=赤い糸ターミナル",
    rakutenUrl: "https://books.rakuten.co.jp/search?sitem=赤い糸ターミナル",
    rentalUrl: "https://www.google.com/search?q=赤い糸ターミナル+レンタル",
  },
];
