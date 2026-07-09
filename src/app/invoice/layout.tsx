import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Invoice generator is management-only — it deals in client bill rates.
export default async function InvoiceLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "MANAGER") redirect("/login");
  return <>{children}</>;
}
