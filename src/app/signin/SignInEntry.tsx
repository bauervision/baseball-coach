"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useAppMode } from "@/lib/teamScope";

export default function SignInEntry() {
  const mode = useAppMode();
  const router = useRouter();
  React.useEffect(() => {
    if (mode === "legacy") router.replace("/");
  }, [mode, router]);
  return null;
}
