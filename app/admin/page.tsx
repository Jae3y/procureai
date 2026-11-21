import type { Metadata } from "next";
import { AdminConsole, AdminLogin } from "@/components/admin-console";
import { pageIsAdmin } from "@/lib/http/page-auth";
import { buildAdminView } from "@/lib/views/admin-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · ProcureAI", robots: { index: false, follow: false } };

export default async function AdminPage() {
  if (!(await pageIsAdmin())) return <AdminLogin />;
  return <AdminConsole initial={await buildAdminView()} />;
}
