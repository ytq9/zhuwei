import type { Metadata } from "next";
import { AuthPanel } from "../auth-panel";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthPanel mode="in" next={next} />;
}
