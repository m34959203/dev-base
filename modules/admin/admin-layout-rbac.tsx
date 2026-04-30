import { getCurrentUser } from "@/lib/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  return (
    <AdminShell user={{ email: user.email, name: user.name, role: user.role }}>
      {children}
    </AdminShell>
  );
}
