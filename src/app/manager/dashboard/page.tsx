import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import BigCrewApp from "@/components/BigCrewApp";

export default async function ManagerDashboard() {
  const session = await getServerSession(authOptions);
  return <BigCrewApp sessionUser={{ name: session?.user?.name ?? "Manager", role: "manager" }} />;
}
