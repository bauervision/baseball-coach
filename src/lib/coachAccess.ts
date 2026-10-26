// Invitation-only coach access (multi-coach mode).
//
// Authorization is decided by Firestore rules (firestore.target.rules), using
// Firebase-verified token claims — never client-supplied emails or uids:
// - coachInvites/{inviteId}: created/revoked only by the owner's Admin SDK
//   tool (tools/coach-invites.mjs). A signed-in Google user with a verified
//   email can read only invites addressed to that email.
// - Accepting is one batch: bind the invite to the caller's uid, create
//   coaches/{uid}, create a new coachWorkspaces/{workspaceId}. Rules check
//   all three together, so an invite binds once, a coach record is created
//   once, and a workspace is created only with its coach record.
// - Afterwards access is coaches/{uid} (status "active") + its workspace
//   (status "active"); the email is not consulted again.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import {
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  signInWithCredential,
  signInWithPopup,
  type Auth,
  type AuthCredential,
  type User,
} from "firebase/auth";

// Emulator builds only: browser tests cannot open Firebase's Google popup
// (it loads apis.google.com, which the test production guard blocks), so a
// test may supply a fake emulator Google ID token on window and the same
// buttons use it instead of the popup. In any other build this is constant
// false and compiled out.
const EMULATOR_BUILD = process.env.BC_EMULATOR_BUILD === "1";
function emulatorTestCredential(): AuthCredential | null {
  if (!EMULATOR_BUILD || typeof window === "undefined") return null;
  const token = (window as unknown as { __bcTestGoogleIdToken?: unknown }).__bcTestGoogleIdToken;
  return typeof token === "string" ? GoogleAuthProvider.credential(token) : null;
}

export type CoachAccess =
  | { state: "approved"; workspaceId: string; via: "existing" | "accepted" | "recovered" }
  | { state: "notApproved"; reason: "noInvite" | "disabled" | "notGoogle" | "unverified" };

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Opaque workspace id: random, never derived from email or uid. */
export function newWorkspaceId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return "ws_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sign-in facts from the verified ID token (not from profile fields). */
export async function tokenFacts(user: User): Promise<{ provider: string; email: string; emailVerified: boolean }> {
  const t = await user.getIdTokenResult();
  return {
    provider: String(t.signInProvider ?? ""),
    email: normalizeEmail(typeof t.claims.email === "string" ? t.claims.email : user.email),
    emailVerified: t.claims.email_verified === true,
  };
}

async function existingCoach(db: Firestore, uid: string): Promise<CoachAccess | null> {
  const coach = await getDoc(doc(db, "coaches", uid));
  if (!coach.exists()) return null;
  const data = coach.data();
  if (data.status !== "active" || typeof data.workspaceId !== "string") {
    return { state: "notApproved", reason: "disabled" };
  }
  try {
    const ws = await getDoc(doc(db, "coachWorkspaces", data.workspaceId));
    if (!ws.exists() || ws.data().status !== "active") return { state: "notApproved", reason: "disabled" };
  } catch {
    // Rules deny workspace reads unless both records are active.
    return { state: "notApproved", reason: "disabled" };
  }
  return { state: "approved", workspaceId: data.workspaceId, via: "existing" };
}

/**
 * Accepts the caller's invitation (if any) and creates their workspace.
 * Idempotent: an existing coach record is returned as is; a concurrent
 * acceptance that won the race is recovered instead of duplicated.
 */
export async function acceptInvitation(db: Firestore, uid: string, email: string): Promise<CoachAccess> {
  const invites = await getDocs(
    query(collection(db, "coachInvites"), where("emailLower", "==", normalizeEmail(email)), where("status", "==", "approved"), limit(1)),
  );
  if (invites.empty) return { state: "notApproved", reason: "noInvite" };
  const invite = invites.docs[0];
  const workspaceId = newWorkspaceId();
  const batch = writeBatch(db);
  batch.update(invite.ref, { status: "accepted", boundUid: uid, acceptedAt: serverTimestamp() });
  batch.set(doc(db, "coaches", uid), { workspaceId, inviteId: invite.id, status: "active", createdAt: serverTimestamp() });
  batch.set(doc(db, "coachWorkspaces", workspaceId), { ownerUid: uid, status: "active", createdAt: serverTimestamp() });
  try {
    await batch.commit();
    return { state: "approved", workspaceId, via: "accepted" };
  } catch (e) {
    const recovered = await existingCoach(db, uid);
    if (recovered?.state === "approved") return { ...recovered, via: "recovered" };
    throw e;
  }
}

/** Decides what a signed-in Firebase user may do in multi-coach mode. */
export async function resolveCoachAccess(db: Firestore, user: User): Promise<CoachAccess> {
  const existing = await existingCoach(db, user.uid);
  if (existing) return existing;
  const facts = await tokenFacts(user);
  if (facts.provider !== "google.com") return { state: "notApproved", reason: "notGoogle" };
  if (!facts.emailVerified) return { state: "notApproved", reason: "unverified" };
  return acceptInvitation(db, user.uid, facts.email);
}

function authCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "unknown";
}

/** "Continue with Google". Returns null when the person closed the window. */
export async function signInWithGoogle(auth: Auth): Promise<User | null> {
  try {
    const testCred = emulatorTestCredential();
    return (testCred ? await signInWithCredential(auth, testCred) : await signInWithPopup(auth, new GoogleAuthProvider())).user;
  } catch (e) {
    const code = authCode(e);
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return null;
    if (code === "auth/popup-blocked") throw new Error("The browser blocked the Google window. Allow pop-ups and try again.");
    if (code === "auth/operation-not-allowed") throw new Error("Google sign-in is not enabled for this project yet.");
    if (code === "auth/account-exists-with-different-credential") {
      throw new Error("This email already has a password sign-in. Sign in with your password, then link Google from Admin.");
    }
    throw new Error("Google sign-in did not complete. Please try again.");
  }
}

export class LinkGoogleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LinkGoogleError";
  }
}

export function hasGoogle(user: User | null): boolean {
  return !!user?.providerData.some((p) => p.providerId === "google.com");
}

/**
 * Links Google to the signed-in account. Never signs in as a different
 * user: fails if Firebase would change the uid, and never removes the
 * password provider.
 */
export async function linkGoogle(auth: Auth): Promise<{ uid: string; providers: string[] }> {
  const user = auth.currentUser;
  if (!user) throw new LinkGoogleError("no-user", "Sign in first, then link Google.");
  const uidBefore = user.uid;
  try {
    const testCred = emulatorTestCredential();
    const res = testCred ? await linkWithCredential(user, testCred) : await linkWithPopup(user, new GoogleAuthProvider());
    if (res.user.uid !== uidBefore) {
      throw new LinkGoogleError("uid-changed", "Linking would change your account; nothing was linked.");
    }
    return { uid: res.user.uid, providers: res.user.providerData.map((p) => p.providerId).sort() };
  } catch (e) {
    if (e instanceof LinkGoogleError) throw e;
    const code = authCode(e);
    const messages: Record<string, string> = {
      "auth/credential-already-in-use": "That Google account already belongs to another sign-in. Nothing was linked.",
      "auth/provider-already-linked": "Google is already linked to this account.",
      "auth/popup-closed-by-user": "The Google window was closed before linking finished.",
      "auth/cancelled-popup-request": "The Google window was closed before linking finished.",
      "auth/popup-blocked": "The browser blocked the Google window. Allow pop-ups and try again.",
      "auth/requires-recent-login": "For safety, sign out and sign in again, then link Google.",
      "auth/operation-not-allowed": "Google sign-in is not enabled for this project yet.",
    };
    throw new LinkGoogleError(code, messages[code] ?? "Google could not be linked. Nothing was changed.");
  }
}
