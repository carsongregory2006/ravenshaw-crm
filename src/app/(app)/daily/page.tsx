import { requireStaff } from "@/lib/auth";
import { DailyView } from "./daily-view";

export const metadata = { title: "Daily inputs" };

export default async function DailyPage() {
  await requireStaff();
  return <DailyView />;
}
