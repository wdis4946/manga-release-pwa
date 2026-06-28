"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, LogIn } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void createSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) {
          router.replace("/admin/manga-matching");
        }
      });
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const { error: signInError } =
      await createSupabaseBrowserClient().auth.signInWithPassword({
        email,
        password,
      });

    if (signInError) {
      setError("メールアドレスまたはパスワードを確認してください。");
      setIsSubmitting(false);
      return;
    }

    router.replace("/admin/manga-matching");
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md items-center px-4 py-10">
      <section className="w-full border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-cyan-700 text-white">
            <KeyRound className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-stone-950">管理者ログイン</h1>
            <p className="text-sm text-stone-500">Manga matching console</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-stone-700">
              メールアドレス
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700 focus:ring-2 focus:ring-cyan-100"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-stone-700">
              パスワード
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700 focus:ring-2 focus:ring-cyan-100"
            />
          </label>

          {error ? (
            <p className="text-sm font-medium text-red-700">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-bold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <LogIn className="size-4" aria-hidden="true" />
            )}
            ログイン
          </button>
        </form>
      </section>
    </main>
  );
}
