// Google sign-in, invitations, and coach workspaces against the Auth and
// Firestore emulators with the TARGET rules (firestore.target.rules).
// Identities are real Auth-emulator accounts (password and fake Google
// tokens), so rules see genuine sign_in_provider / email_verified claims.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  linkWithCredential,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  terminate,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { PROJECT_ID, admin, clearFirestore, expectDenied, seed } from "./support.mjs";
import { acceptInvitation, resolveCoachAccess } from "../../src/lib/coachAccess.ts";
import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";
import { productionShapedSnapshot } from "../support/productionShapedFixture.mjs";

setLogLevel("silent");
const TARGET = fs.readFileSync("firestore.target.rules", "utf8");
const REPO = fs.readFileSync("firestore.rules", "utf8");
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-access-"));

const ORIGINAL_EMAIL = "original.coach@gmail.com";
const NEW_EMAIL = "new.coach@gmail.com";
const STRANGER_EMAIL = "stranger@gmail.com";

async function loadRules(content) {
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}:securityRules`, {
    method: "PUT",
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}

const apps = [];
function client() {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com` }, `c${apps.length}-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, fsHost, Number(fsPort));
  apps.push({ app, db });
  return { auth, db };
}
const googleCred = (email) => GoogleAuthProvider.credential(JSON.stringify({ sub: `google-${email}`, email, email_verified: true }));
async function googleCoach(email) {
  const c = client();
  await signInWithCredential(c.auth, googleCred(email));
  return c;
}
// Async (not spawnSync): blocking the event loop lets the Auth emulator close
// kept-alive sockets, and the next auth call then fails on a dead connection.
function run(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.resolve("tools", script), ...args], { cwd: dir });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}
const tool = (script, args) => run(script, ["--project", PROJECT_ID, ...args]);
const exportTo = (file) => run("export-firestore.mjs", ["--project", PROJECT_ID, "--out", file]);
const inviteFor = async (email) => (await admin.collection("coachInvites").where("emailLower", "==", email).get()).docs[0];
const wsCount = async (uid) => (await admin.collection("coachWorkspaces").where("ownerUid", "==", uid).get()).size;

let originalUid;
before(async () => loadRules(TARGET));
after(async () => {
  for (const { app, db } of apps) {
    await terminate(db);
    await deleteApp(app);
  }
  await loadRules(REPO);
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await clearFirestore();
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  // The original coach: an existing email/password account (unverified email), allowlisted.
  const c = client();
  originalUid = (await createUserWithEmailAndPassword(c.auth, ORIGINAL_EMAIL, "fixture-pass-123")).user.uid;
  await seed(productionShapedSnapshot({ migrated: true }), [originalUid]);
  await admin.doc("teams/falcons-0001").set({ ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "falcons-0001", teamName: "Falcons", createdAt: new Date(), updatedAt: new Date() });
});

test("linking Google keeps the original UID and the password sign-in", async () => {
  const c = client();
  const { user } = await signInWithEmailAndPassword(c.auth, ORIGINAL_EMAIL, "fixture-pass-123");
  assert.equal(user.uid, originalUid);
  const linked = await linkWithCredential(user, googleCred(ORIGINAL_EMAIL));
  assert.equal(linked.user.uid, originalUid, "UID unchanged");
  assert.deepEqual(linked.user.providerData.map((p) => p.providerId).sort(), ["google.com", "password"]);
  await signOut(c.auth);
  assert.equal((await signInWithCredential(c.auth, googleCred(ORIGINAL_EMAIL))).user.uid, originalUid, "Google sign-in lands on the same account");
  await signOut(c.auth);
  assert.equal((await signInWithEmailAndPassword(c.auth, ORIGINAL_EMAIL, "fixture-pass-123")).user.uid, originalUid, "password still works");
});

test("original coach: migration tool binds the existing UID to the first workspace; access survives linking", async () => {
  assert.equal((await tool("coach-workspace-migrate.mjs", ["--uid", "not-the-admin", "--email", ORIGINAL_EMAIL])).code, 3, "unknown uid refused");
  const dry = await tool("coach-workspace-migrate.mjs", ["--uid", originalUid, "--email", ORIGINAL_EMAIL]);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /planned writes: 6/, "invite + workspace + coach + 1 team + 2 seasons");
  assert.equal((await exportTo("backup.json")).code, 0);
  const applied = await tool("coach-workspace-migrate.mjs", ["--uid", originalUid, "--email", ORIGINAL_EMAIL, "--backup", "backup.json", "--apply"]);
  assert.equal(applied.code, 0, applied.out);
  assert.match((await tool("coach-workspace-migrate.mjs", ["--uid", originalUid, "--email", ORIGINAL_EMAIL])).out, /planned writes: 0/, "idempotent");

  // Password session (before linking) and Google session (after) both resolve to the same workspace.
  const c = client();
  await signInWithEmailAndPassword(c.auth, ORIGINAL_EMAIL, "fixture-pass-123");
  const a1 = await resolveCoachAccess(c.db, c.auth.currentUser);
  assert.equal(a1.state, "approved");
  await linkWithCredential(c.auth.currentUser, googleCred(ORIGINAL_EMAIL));
  await signOut(c.auth);
  await signInWithCredential(c.auth, googleCred(ORIGINAL_EMAIL));
  const a2 = await resolveCoachAccess(c.db, c.auth.currentUser);
  assert.deepEqual(a2, { state: "approved", workspaceId: a1.workspaceId, via: "existing" });
  const teams = await getDocs(query(collection(c.db, "teams"), where("ownerUid", "==", originalUid)));
  assert.deepEqual(teams.docs.map((d) => d.id), ["falcons-0001"]);
  assert.equal(await wsCount(originalUid), 1);
});

test("approved new coach: Google sign-in accepts the invite and gets one empty workspace", async () => {
  assert.match((await tool("coach-invites.mjs", ["--create", NEW_EMAIL])).out, /Would create/, "preview by default");
  assert.match((await tool("coach-invites.mjs", ["--create", NEW_EMAIL, "--apply"])).out, /Created invite/);
  assert.match((await tool("coach-invites.mjs", ["--create", NEW_EMAIL, "--apply"])).out, /already exists/, "no duplicate invites");

  const c = await googleCoach(NEW_EMAIL);
  const uid = c.auth.currentUser.uid;
  const first = await resolveCoachAccess(c.db, c.auth.currentUser);
  assert.equal(first.state, "approved");
  assert.equal(first.via, "accepted");
  assert.notEqual(first.workspaceId, uid);
  assert.doesNotMatch(first.workspaceId, /new\.coach|gmail/);
  const inv = (await inviteFor(NEW_EMAIL)).data();
  assert.equal(inv.status, "accepted");
  assert.equal(inv.boundUid, uid);
  // Repeat sign-ins and concurrent retries recover the same workspace.
  assert.deepEqual(await resolveCoachAccess(c.db, c.auth.currentUser), { state: "approved", workspaceId: first.workspaceId, via: "existing" });
  const again = await googleCoach(NEW_EMAIL);
  assert.equal((await resolveCoachAccess(again.db, again.auth.currentUser)).workspaceId, first.workspaceId);
  assert.equal(await wsCount(uid), 1);
  // Empty workspace: none of the original coach's data.
  assert.equal((await getDocs(query(collection(c.db, "teams"), where("ownerUid", "==", uid)))).size, 0);
  await expectDenied(getDocs(query(collection(c.db, "teams"), where("ownerUid", "==", originalUid))));
});

test("concurrent first sign-ins create exactly one workspace", async () => {
  await tool("coach-invites.mjs", ["--create", NEW_EMAIL, "--apply"]);
  const a = await googleCoach(NEW_EMAIL);
  const b = client();
  await signInWithCredential(b.auth, googleCred(NEW_EMAIL));
  const [r1, r2] = await Promise.all([resolveCoachAccess(a.db, a.auth.currentUser), resolveCoachAccess(b.db, b.auth.currentUser)]);
  assert.equal(r1.workspaceId, r2.workspaceId);
  assert.equal(await wsCount(a.auth.currentUser.uid), 1);
});

test("unapproved Google users get no workspace and no private data", async () => {
  await tool("coach-invites.mjs", ["--create", NEW_EMAIL, "--apply"]);
  const s = await googleCoach(STRANGER_EMAIL);
  const uid = s.auth.currentUser.uid;
  assert.deepEqual(await resolveCoachAccess(s.db, s.auth.currentUser), { state: "notApproved", reason: "noInvite" });
  assert.equal((await admin.doc(`coaches/${uid}`).get()).exists, false);
  assert.equal(await wsCount(uid), 0);
  // Cannot see or claim someone else's invite.
  await expectDenied(getDocs(query(collection(s.db, "coachInvites"), where("emailLower", "==", NEW_EMAIL))));
  await expectDenied(getDocs(collection(s.db, "coachInvites")));
  const inv = await inviteFor(NEW_EMAIL);
  await expectDenied(updateDoc(doc(s.db, "coachInvites", inv.id), { status: "accepted", boundUid: uid, acceptedAt: serverTimestamp() }));
  // Cannot forge records directly.
  const b = writeBatch(s.db);
  b.set(doc(s.db, "coaches", uid), { workspaceId: "ws_forged", inviteId: inv.id, status: "active", createdAt: serverTimestamp() });
  b.set(doc(s.db, "coachWorkspaces", "ws_forged"), { ownerUid: uid, status: "active", createdAt: serverTimestamp() });
  await expectDenied(b.commit());
  await expectDenied(setDoc(doc(s.db, "coachInvites", "inv_forged"), { emailLower: STRANGER_EMAIL, status: "approved", boundUid: null }));
  for (const p of ["teams/falcons-0001", `seasons/tigers-fall-2026/players/21-alex-rivera/private/profile`, `coaches/${originalUid}`]) {
    await expectDenied(getDoc(doc(s.db, p)));
  }
});

test("an invite binds once; a password or unverified identity cannot accept it", async () => {
  await tool("coach-invites.mjs", ["--create", ORIGINAL_EMAIL, "--apply"]);
  // The original coach's PASSWORD session (unverified email) cannot accept.
  const p = client();
  await signInWithEmailAndPassword(p.auth, ORIGINAL_EMAIL, "fixture-pass-123");
  assert.deepEqual(await resolveCoachAccess(p.db, p.auth.currentUser), { state: "notApproved", reason: "notGoogle" });
  await expectDenied(acceptInvitation(p.db, p.auth.currentUser.uid, ORIGINAL_EMAIL));
  // A Google token whose email is unverified cannot either.
  const u = client();
  await signInWithCredential(u.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: "google-unverified", email: "unverified@gmail.com", email_verified: false })));
  await tool("coach-invites.mjs", ["--create", "unverified@gmail.com", "--apply"]);
  assert.equal((await resolveCoachAccess(u.db, u.auth.currentUser)).state, "notApproved");
  assert.equal((await inviteFor("unverified@gmail.com")).data().status, "approved", "still unaccepted");
});

test("revoked invites and disabled coaches/workspaces lose access", async () => {
  // Revoked before acceptance: no access.
  await tool("coach-invites.mjs", ["--create", NEW_EMAIL, "--apply"]);
  const inv = await inviteFor(NEW_EMAIL);
  assert.match((await tool("coach-invites.mjs", ["--revoke", inv.id, "--apply"])).out, /revoked/);
  const c = await googleCoach(NEW_EMAIL);
  assert.deepEqual(await resolveCoachAccess(c.db, c.auth.currentUser), { state: "notApproved", reason: "noInvite" });

  // Accepted, then revoked: the coach is disabled and loses private access.
  await admin.doc(`coachInvites/${inv.id}`).delete();
  await tool("coach-invites.mjs", ["--create", NEW_EMAIL, "--apply"]);
  const ok = await resolveCoachAccess(c.db, c.auth.currentUser);
  assert.equal(ok.state, "approved");
  await setDoc(doc(c.db, "teams", "hawks-0001"), { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "hawks-0001", teamName: "Hawks", ownerUid: c.auth.currentUser.uid, workspaceId: ok.workspaceId, createdAt: new Date(), updatedAt: new Date() });
  const accepted = await inviteFor(NEW_EMAIL);
  assert.match((await tool("coach-invites.mjs", ["--revoke", accepted.id, "--apply"])).out, /disabled/);
  assert.deepEqual(await resolveCoachAccess(c.db, c.auth.currentUser), { state: "notApproved", reason: "disabled" });
  await expectDenied(getDoc(doc(c.db, "teams", "hawks-0001")));

  // A disabled workspace alone also removes access.
  await admin.doc(`coaches/${c.auth.currentUser.uid}`).update({ status: "active" });
  assert.ok((await getDoc(doc(c.db, "teams", "hawks-0001"))).exists());
  await admin.doc(`coachWorkspaces/${ok.workspaceId}`).update({ status: "disabled" });
  await expectDenied(getDoc(doc(c.db, "teams", "hawks-0001")));
  assert.equal((await resolveCoachAccess(c.db, c.auth.currentUser)).state, "notApproved");
});

test("cross-coach isolation between the original coach and a new coach", async () => {
  await tool("coach-workspace-migrate.mjs", ["--uid", originalUid, "--email", ORIGINAL_EMAIL]);
  await exportTo("b2.json");
  await tool("coach-workspace-migrate.mjs", ["--uid", originalUid, "--email", ORIGINAL_EMAIL, "--backup", "b2.json", "--apply"]);
  await tool("coach-invites.mjs", ["--create", NEW_EMAIL, "--apply"]);
  const n = await googleCoach(NEW_EMAIL);
  const nAccess = await resolveCoachAccess(n.db, n.auth.currentUser);
  const nUid = n.auth.currentUser.uid;
  const o = client();
  await signInWithEmailAndPassword(o.auth, ORIGINAL_EMAIL, "fixture-pass-123");
  const oAccess = await resolveCoachAccess(o.db, o.auth.currentUser);

  // New coach: own team in own workspace only.
  await setDoc(doc(n.db, "teams", "hawks-0001"), { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "hawks-0001", teamName: "Hawks", ownerUid: nUid, workspaceId: nAccess.workspaceId, createdAt: new Date(), updatedAt: new Date() });
  await expectDenied(setDoc(doc(n.db, "teams", "x-0001"), { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "x-0001", ownerUid: nUid, workspaceId: oAccess.workspaceId, createdAt: new Date(), updatedAt: new Date() }), "foreign workspace");
  for (const [me, otherUid, otherTeam, otherWs] of [[n, originalUid, "falcons-0001", oAccess.workspaceId], [o, nUid, "hawks-0001", nAccess.workspaceId]]) {
    await expectDenied(getDoc(doc(me.db, "teams", otherTeam)));
    await expectDenied(getDoc(doc(me.db, "coachWorkspaces", otherWs)));
    await expectDenied(getDoc(doc(me.db, "coaches", otherUid)));
    await expectDenied(updateDoc(doc(me.db, "teams", otherTeam), { teamName: "Mine" }));
    await expectDenied(getDocs(query(collection(me.db, "teams"), where("ownerUid", "==", otherUid))));
    await expectDenied(getDocs(query(collection(me.db, "playerIdentities"), where("managerUids", "array-contains", otherUid))));
    await expectDenied(getDocs(collection(me.db, "coachProfiles", otherUid, "linkedPlayers")));
  }
  // Ownership cannot be reassigned.
  await expectDenied(updateDoc(doc(n.db, "teams", "hawks-0001"), { ownerUid: originalUid }));
  await expectDenied(updateDoc(doc(o.db, "seasons", "tigers-fall-2026"), { ownerUid: nUid }));
  await expectDenied(updateDoc(doc(n.db, "coaches", nUid), { workspaceId: oAccess.workspaceId }));
});
