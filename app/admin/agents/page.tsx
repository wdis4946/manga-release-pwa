import { AgentsManagementConsole } from "@/components/admin/AgentsManagementConsole";

export const metadata = {
  title: "作者管理 | Manga Release",
};

type AgentsAdminPageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function AgentsAdminPage({
  searchParams,
}: AgentsAdminPageProps) {
  const { q } = await searchParams;
  const initialQuery = Array.isArray(q) ? (q[0] ?? "") : (q ?? "");

  return <AgentsManagementConsole initialQuery={initialQuery.trim()} />;
}
