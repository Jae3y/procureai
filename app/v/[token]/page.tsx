import { PageMessage } from "@/components/states";
import { VendorPhone } from "@/components/vendor-phone";
import { DomainError } from "@/lib/domain/errors";
import { buildVendorView } from "@/lib/views/vendor-view";

export const dynamic = "force-dynamic";

export default async function VendorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const view = await buildVendorView(token);
    return <VendorPhone token={token} initial={view} />;
  } catch (err) {
    if (err instanceof DomainError && err.code === "invalid_link") {
      return <PageMessage title="This link isn't valid." body="It may have expired. Ask the buyer to send it again." />;
    }
    throw err;
  }
}
