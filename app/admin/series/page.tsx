import { SeriesManagementConsole } from "@/components/admin/SeriesManagementConsole";

export const metadata = {
  title: "シリーズ管理 | Manga Release",
};

type SeriesAdminPageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function SeriesAdminPage({
  searchParams,
}: SeriesAdminPageProps) {
  const { q } = await searchParams;
  const initialQuery = Array.isArray(q) ? (q[0] ?? "") : (q ?? "");

  return <SeriesManagementConsole initialQuery={initialQuery.trim()} />;
}
