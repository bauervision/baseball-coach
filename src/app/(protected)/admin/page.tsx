import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { NotAuthorized } from "@/components/auth/NotAuthorized";
import AdminClient from "./AdminClient";

export default function Page() {
  return (
    <ProtectedRoute
      allow={["admin"]}
      fallback={<NotAuthorized message="Admin access is required." />}
    >
      <AdminClient />
    </ProtectedRoute>
  );
}
