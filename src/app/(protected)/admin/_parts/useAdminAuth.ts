// app/admin/_parts/useAdminAuth.ts
"use client";

import * as React from "react";
import { onAuthStateChanged, type Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { signInWithEmailAndPassword } from "@/lib/firebase.client";
import { checkAllowlist } from "./adminActions";

export function useAdminAuth(opts: { auth: Auth; db: Firestore }) {
  const { auth, db } = opts;

  const [authReady, setAuthReady] = React.useState(false);
  const [uid, setUid] = React.useState<string | null>(null);
  const [isAllowlisted, setIsAllowlisted] = React.useState<boolean | null>(null);

  const [signingIn, setSigningIn] = React.useState(false);
  const [signInError, setSignInError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUid(u?.uid ?? null);
      setAuthReady(true);

      if (!u?.uid) {
        setIsAllowlisted(null);
        return;
      }

      try {
        const ok = await checkAllowlist({ db, uid: u.uid });
        setIsAllowlisted(ok);
      } catch {
        setIsAllowlisted(false);
      }
    });

    return () => unsub();
  }, [auth, db]);

  const signInAction = React.useCallback(
    async (email: string, password: string, onSuccess?: () => void) => {
      if (signingIn) return;

      setSignInError(null);
      setSigningIn(true);

      try {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        onSuccess?.();
      } catch (e: unknown) {
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as { message?: unknown }).message)
            : "Sign in failed.";
        setSignInError(msg);
      } finally {
        setSigningIn(false);
      }
    },
    [auth, signingIn],
  );

  const canEdit = uid !== null && isAllowlisted === true;

  return {
    authReady,
    uid,
    isAllowlisted,
    canEdit,
    signingIn,
    signInError,
    signInAction,
    setSignInError,
  };
}