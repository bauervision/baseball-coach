"use client";

// Chooses the Admin experience after hydration: multi-coach mode (workspace
// gate) or the existing single-coach Admin. Deciding on the client avoids a
// mismatch with the static HTML when an emulator test switches the flag.

import * as React from "react";

import { CoachWorkspaceGate } from "@/components/auth/CoachWorkspaceGate";
import { multiCoachEnabled } from "@/lib/features";
import AdminClient from "./AdminClient";

export default function AdminEntry() {
  const [multiCoach, setMultiCoach] = React.useState<boolean | null>(null);
  React.useEffect(() => setMultiCoach(multiCoachEnabled()), []);
  if (multiCoach === null) return null;
  return multiCoach ? <CoachWorkspaceGate /> : <AdminClient />;
}
