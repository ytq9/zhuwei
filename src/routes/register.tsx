import { createFileRoute } from "@tanstack/react-router";
import { AuthPanel } from "@/components/auth-panel";

export const Route = createFileRoute("/register")({
  ssr: false,
  component: Register,
});

function Register() {
  return <AuthPanel mode="up" />;
}
