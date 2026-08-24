import type { Metadata } from "next";
import { AuthPanel } from "../auth-panel";

export const metadata: Metadata = { title: "注册" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthPanel mode="up" next={next} />;
}
