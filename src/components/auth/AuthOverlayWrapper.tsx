"use client";

import * as React from "react";
import AuthOverlayHost from "@/components/layout/AuthOverlayHost";
import { AuthOverlay } from "@/components/auth/AuthOverlay";
import { ThemeBoot } from "@/components/theme/ThemeBoot";
import { ShellLayout } from "@/components/shell/ShellLayout";

export function AuthOverlayWrapper(props: { children: React.ReactNode }) {
  return (
    <>
      <ThemeBoot />
      <AuthOverlayHost />
      <AuthOverlay>
        <ShellLayout>{props.children}</ShellLayout>
      </AuthOverlay>
    </>
  );
}