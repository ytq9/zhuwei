import { createFileRoute } from "@tanstack/react-router";
import { AuthPanel } from "@/components/auth-panel";

export const Route = createFileRoute("/login")({
  ssr: false,
  component: Login,
});

function Login() {
  return <AuthPanel mode="in" />;
}
