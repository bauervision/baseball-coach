import * as React from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { NotAuthorized } from "@/components/auth/NotAuthorized";
import AdminEntry from "./AdminEntry";

export default function Page() {
  return (
    <ProtectedRoute
      allow={["admin", "coach"]}
      fallback={<NotAuthorized message="Admin access is required." />}
    >
      {/* AdminClient reads the URL (guided setup) via useSearchParams. */}
      <React.Suspense fallback={null}>
        <AdminEntry />
      </React.Suspense>
    </ProtectedRoute>
  );
}
