// Coach invitations (owner only; Admin SDK). Clients can never create,
// revoke, or list invites (firestore.target.rules).
//
//   node tools/coach-invites.mjs --project <id> --list
//   node tools/coach-invites.mjs --project <id> --create coach@example.com [--apply]
//   node tools/coach-invites.mjs --project <id> --revoke <inviteId> [--apply]
//
// Create/revoke are previews unless --apply. Revoking an accepted invite also
// disables the bound coach (coaches/{uid}.status = "disabled"), which removes
// all private access under the target rules. Real projects additionally
// require --allow-production. Emails are printed only for --list.

import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { arg, connect, flag } from "./identity/firestore.mjs";

const normalize = (e) => String(e ?? "").trim().toLowerCase();

async function main() {
  const { db } = connect({ productionFlag: "--allow-production" });
  const apply = flag("--apply");

  if (flag("--list")) {
    const snap = await db.collection("coachInvites").orderBy("createdAt").get();
    for (const d of snap.docs) {
      const v = d.data();
      console.log(`${d.id}  ${v.status.padEnd(8)}  ${v.emailLower}  ${v.boundUid ? "bound" : "unbound"}  issuedBy=${v.issuedBy}`);
    }
    console.log(`${snap.size} invite(s).`);
    return;
  }

  const email = arg("--create");
  if (email !== undefined) {
    const emailLower = normalize(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailLower)) throw new Error("Pass a valid email to --create.");
    const open = await db.collection("coachInvites").where("emailLower", "==", emailLower).where("status", "in", ["approved", "accepted"]).get();
    if (!open.empty) {
      console.log(`An ${open.docs[0].data().status} invite already exists for this email (${open.docs[0].id}); nothing created.`);
      return;
    }
    const id = `inv_${crypto.randomBytes(10).toString("hex")}`;
    const data = { emailLower, status: "approved", boundUid: null, issuedBy: "owner-cli", createdAt: FieldValue.serverTimestamp() };
    if (!apply) {
      console.log(`Would create invite ${id} (status approved). Re-run with --apply.`);
      return;
    }
    await db.doc(`coachInvites/${id}`).create(data);
    console.log(`Created invite ${id}.`);
    return;
  }

  const revokeId = arg("--revoke");
  if (revokeId !== undefined) {
    const ref = db.doc(`coachInvites/${revokeId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`Invite ${revokeId} does not exist.`);
    const v = snap.data();
    if (v.status === "revoked") {
      console.log("Already revoked.");
      return;
    }
    const plan = [`invite ${revokeId}: ${v.status} → revoked`];
    if (v.boundUid) plan.push("bound coach: status → disabled (all private access removed)");
    if (!apply) {
      console.log(`Would apply:\n  ${plan.join("\n  ")}\nRe-run with --apply.`);
      return;
    }
    const batch = db.batch();
    batch.update(ref, { status: "revoked", revokedAt: FieldValue.serverTimestamp() });
    if (v.boundUid) batch.update(db.doc(`coaches/${v.boundUid}`), { status: "disabled" });
    await batch.commit();
    console.log(`Applied:\n  ${plan.join("\n  ")}`);
    return;
  }

  throw new Error("Pass --list, --create <email>, or --revoke <inviteId>.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
