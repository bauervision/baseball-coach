import * as React from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { NotAuthorized } from "@/components/auth/NotAuthorized";
import AdminClient from "./AdminClient";

export default function Page() {
  return (
    <ProtectedRoute
      allow={["admin"]}
      fallback={<NotAuthorized message="Admin access is required." />}
    >
      {/* AdminClient reads the URL (guided setup) via useSearchParams. */}
      <React.Suspense fallback={null}>
        <AdminClient />
      </React.Suspense>
    </ProtectedRoute>
  );
}
