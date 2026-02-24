import { doc, writeBatch, serverTimestamp } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { SEASON_ID } from "@/lib/rosterStore";

type SeedPlayer = {
  id: string;
  name: string;
  number: number;
  bats: string | null;
  throws: string | null;
  primaryPos: string | null;
};

const PLAYERS: SeedPlayer[] = [
  {
    id: "p01",
    name: "Rylan Davenport",
    number: 7,
    bats: "R",
    throws: "R",
    primaryPos: "SS",
  },
  {
    id: "p02",
    name: "Marshall Gonze",
    number: 12,
    bats: "L",
    throws: "R",
    primaryPos: "CF",
  },
  {
    id: "p03",
    name: "Luke Bauer",
    number: 3,
    bats: "R",
    throws: "R",
    primaryPos: "2B",
  },
  {
    id: "p04",
    name: "Noah Green",
    number: 9,
    bats: "R",
    throws: "R",
    primaryPos: "1B",
  },
  {
    id: "p05",
    name: "Declan Gwynn",
    number: 21,
    bats: "L",
    throws: "L",
    primaryPos: "P",
  },
  {
    id: "p06",
    name: "Noah McComiskey",
    number: 18,
    bats: "S",
    throws: "R",
    primaryPos: "C",
  },
  {
    id: "p07",
    name: "Braydon Myers",
    number: 2,
    bats: "R",
    throws: "R",
    primaryPos: "3B",
  },
  {
    id: "p08",
    name: "Keagan Russell",
    number: 14,
    bats: "L",
    throws: "R",
    primaryPos: "RF",
  },
  {
    id: "p09",
    name: "Joel Sanders",
    number: 5,
    bats: "R",
    throws: "L",
    primaryPos: "LF",
  },
  {
    id: "p10",
    name: "Kolby Suter",
    number: 11,
    bats: "R",
    throws: "R",
    primaryPos: "P",
  },
  {
    id: "p11",
    name: "Brayden Wojcicki",
    number: 8,
    bats: "L",
    throws: "L",
    primaryPos: "CF",
  },
  {
    id: "p12",
    name: "John Bazemore",
    number: 16,
    bats: "R",
    throws: "R",
    primaryPos: "3B",
  },
];

export async function seedPlayers() {
  const batch = writeBatch(firestore);

  for (const p of PLAYERS) {
    const ref = doc(firestore, "seasons", SEASON_ID, "players", p.id);

    batch.set(ref, {
      id: p.id,
      name: p.name,
      number: p.number,
      bats: p.bats,
      throws: p.throws,
      primaryPos: p.primaryPos,
      stats: {
        games: 0,
        plateAppearances: 0,
        atBats: 0,
        hits: 0,
        doubles: 0,
        triples: 0,
        homeRuns: 0,
        runs: 0,
        rbi: 0,
        walks: 0,
        hitByPitch: 0,
      },
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}
