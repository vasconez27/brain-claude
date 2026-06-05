import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import BigCrewApp from "@/components/BigCrewApp";

export default async function CrewDashboard() {
  const session = await getServerSession(authOptions);
  return <BigCrewApp sessionUser={{ id: session?.user?.id, email: session?.user?.email ?? "", name: session?.user?.name ?? "Crew", role: "crew" }} />;
}
