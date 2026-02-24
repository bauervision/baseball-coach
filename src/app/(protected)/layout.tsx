import * as React from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

export default function ProtectedLayout(props: { children: React.ReactNode }) {
  return <ProtectedRoute>{props.children}</ProtectedRoute>;
}
