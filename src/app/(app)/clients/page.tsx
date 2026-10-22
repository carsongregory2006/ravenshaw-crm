import { BadgeCheck } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { listClients } from "@/lib/billing/queries";
import { ClientsTable } from "@/components/billing/clients-table";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const rows = await listClients();
  return (
    <Page>
      <PageHeader icon={BadgeCheck} title="Clients">
        <span className="text-[13px] text-fg-3">{rows.length}</span>
      </PageHeader>
      <ClientsTable rows={rows} />
    </Page>
  );
}
