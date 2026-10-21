// Private player registry and coach-linked children.
//
//   playerIdentities/{careerPlayerId}
//     { careerPlayerId, displayName, managerUids[], createdByUid, createdAt,
//       updatedAt }
//   coachProfiles/{uid}/linkedPlayers/{careerPlayerId}
//     { careerPlayerId, displayName, relationship: "child", confirmed: true,
//       linkedAt }
//
// Both are readable only by the managing/owning coach (see firestore.rules)
// and are never part of the public season tree. Gate all callers on
// PLAYER_REGISTRY_ENABLED until those rules are deployed.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { newCareerPlayerId, normalizeCareerPlayerId } from "@/lib/playerIdentity";

export type RegistryIdentity = { careerPlayerId: string; displayName: string };
export type LinkedPlayer = RegistryIdentity & { relationship: "child" };

export async function listManagedIdentities(
  db: Firestore,
  uid: string,
): Promise<RegistryIdentity[]> {
  const snap = await getDocs(
    query(
      collection(db, "playerIdentities"),
      where("managerUids", "array-contains", uid),
    ),
  );
  return snap.docs.map((d) => ({
    careerPlayerId: d.id,
    displayName: String(d.data().displayName ?? ""),
  }));
}

export async function listLinkedPlayers(
  db: Firestore,
  uid: string,
): Promise<LinkedPlayer[]> {
  const snap = await getDocs(collection(db, "coachProfiles", uid, "linkedPlayers"));
  return snap.docs.map((d) => ({
    careerPlayerId: d.id,
    displayName: String(d.data().displayName ?? ""),
    relationship: "child",
  }));
}

/**
 * Records that `uid` manages an identity. Creates the registry doc when
 * absent; leaves another coach's identity untouched (returns false).
 */
export async function ensureManagedIdentity(opts: {
  db: Firestore;
  uid: string;
  careerPlayerId: string;
  displayName: string;
}): Promise<boolean> {
  const { db, uid, displayName } = opts;
  const id = normalizeCareerPlayerId(opts.careerPlayerId);
  if (!id) throw new Error("Missing permanent player id.");
  const ref = doc(db, "playerIdentities", id);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch {
    return false; // exists but managed by someone else
  }
  if (snap.exists()) {
    await setDoc(
      ref,
      { displayName: displayName.trim(), updatedAt: serverTimestamp() },
      { merge: true },
    );
    return true;
  }
  await setDoc(ref, {
    careerPlayerId: id,
    displayName: displayName.trim(),
    managerUids: [uid],
    createdByUid: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

/** Links an identity the coach already manages as their child. */
export async function linkExistingChild(opts: {
  db: Firestore;
  uid: string;
  careerPlayerId: string;
  displayName: string;
}): Promise<void> {
  const id = normalizeCareerPlayerId(opts.careerPlayerId);
  if (!id) throw new Error("Missing permanent player id.");
  await setDoc(doc(opts.db, "coachProfiles", opts.uid, "linkedPlayers", id), {
    careerPlayerId: id,
    displayName: opts.displayName.trim(),
    relationship: "child",
    confirmed: true,
    linkedAt: serverTimestamp(),
  });
}

/** Creates a brand-new identity and links it as the coach's child. */
export async function createAndLinkChild(opts: {
  db: Firestore;
  uid: string;
  displayName: string;
}): Promise<string> {
  const { db, uid } = opts;
  const displayName = opts.displayName.trim();
  if (!displayName) throw new Error("Enter your child's name.");
  const id = newCareerPlayerId();
  const batch = writeBatch(db);
  batch.set(doc(db, "playerIdentities", id), {
    careerPlayerId: id,
    displayName,
    managerUids: [uid],
    createdByUid: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, "coachProfiles", uid, "linkedPlayers", id), {
    careerPlayerId: id,
    displayName,
    relationship: "child",
    confirmed: true,
    linkedAt: serverTimestamp(),
  });
  await batch.commit();
  return id;
}

export async function unlinkChild(opts: {
  db: Firestore;
  uid: string;
  careerPlayerId: string;
}): Promise<void> {
  await deleteDoc(
    doc(opts.db, "coachProfiles", opts.uid, "linkedPlayers", opts.careerPlayerId),
  );
}
