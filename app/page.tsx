import { redirect } from "next/navigation";

/** The product starts at the request screen. */
export default function Home() {
  redirect("/buy");
}
