import { cookies } from "next/headers";
import { HomePage } from "@/components/home-page";
import { exampleRequests } from "@/lib/examples";
import { accountCookieName } from "@/lib/http/session";

/** Only whether a session cookie is present (no database call): the header then says "Your account" instead of "Sign in". */
export default async function Home() {
  const signedIn = Boolean((await cookies()).get(accountCookieName())?.value);
  return <HomePage signedIn={signedIn} examples={exampleRequests()} />;
}
