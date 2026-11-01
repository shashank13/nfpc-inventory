import { redirect } from "next/navigation";

// Open the dashboard (it sends visitors who aren't signed in to /login).
export default function Home() {
  redirect("/dashboard");
}
