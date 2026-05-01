import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  battingAverage,
  fmt3,
  onBasePercentage,
  ops,
  slugging,
} from "@/lib/roster";
import type { Player } from "@/lib/roster";
import type { TrophyAward } from "@/lib/trophies";

export function exportPlayerStatsPdf(opts: {
  teamName: string;
  seasonLabel: string;
  player: Player;
  awards: TrophyAward[];
}) {
  const { teamName, seasonLabel, player, awards } = opts;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
  });

  doc.setFontSize(20);
  doc.text(player.name, 40, 42);

  doc.setFontSize(12);
  doc.text(`#${player.number} • ${teamName} • ${seasonLabel}`, 40, 62);

  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 420, 42);

  autoTable(doc, {
    startY: 86,
    head: [["AVG", "OBP", "SLG", "OPS"]],
    body: [
      [
        fmt3(battingAverage(player)),
        fmt3(onBasePercentage(player)),
        fmt3(slugging(player)),
        fmt3(ops(player)),
      ],
    ],
    theme: "grid",
    styles: {
      fontSize: 18,
      halign: "center",
      cellPadding: 8,
      fontStyle: "bold",
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: 20,
      fontSize: 9,
    },
  });

  autoTable(doc, {
    startY: 170,
    head: [["Batting Stat", "Value", "Batting Stat", "Value"]],
    body: [
      ["Games Played", player.stats.games, "Plate Appearances", player.stats.plateAppearances],
      ["At Bats", player.stats.atBats, "Hits", player.stats.hits],
      ["Doubles", player.stats.doubles, "Triples", player.stats.triples],
      ["Home Runs", player.stats.homeRuns, "RBIs", player.stats.rbi],
      ["Runs", player.stats.runs, "Walks", player.stats.walks],
      ["Hit By Pitch", player.stats.hitByPitch, "Stolen Bases", player.stats.stolenBases],
    ],
    theme: "grid",
    styles: {
      fontSize: 10,
      cellPadding: 5,
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: 20,
      fontStyle: "bold",
    },
    columnStyles: {
      1: { halign: "center", fontStyle: "bold" },
      3: { halign: "center", fontStyle: "bold" },
    },
  });

  autoTable(doc, {
    startY:
      ((doc as unknown as { lastAutoTable?: { finalY?: number } })
        .lastAutoTable?.finalY ?? 260) + 18,
    head: [["Defensive Stat", "Value", "Defensive Stat", "Value"]],
    body: [
      ["Pitching Strikeouts", player.stats.pitchingStrikeouts, "Pitching Saves", player.stats.pitchingSaves],
      ["Fly Balls Caught", player.stats.flyBallCatches, "Put Outs", player.stats.putOuts],
      ["Assists", player.stats.assists, "", ""],
    ],
    theme: "grid",
    styles: {
      fontSize: 10,
      cellPadding: 5,
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: 20,
      fontStyle: "bold",
    },
    columnStyles: {
      1: { halign: "center", fontStyle: "bold" },
      3: { halign: "center", fontStyle: "bold" },
    },
  });

  autoTable(doc, {
    startY:
      ((doc as unknown as { lastAutoTable?: { finalY?: number } })
        .lastAutoTable?.finalY ?? 360) + 18,
    head: [["Trophy Outlook", "Current Lead"]],
    body:
      awards.length > 0
        ? awards.map((award) => [
            award.trophy.title,
            `${award.valueLabel}${award.valueSub ? ` — ${award.valueSub}` : ""}`,
          ])
        : [["No current trophy lead yet", "Keep recording games and strengths will show up"]],
    theme: "grid",
    styles: {
      fontSize: 10,
      cellPadding: 5,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: 20,
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 170 },
      1: { cellWidth: 350 },
    },
  });

  doc.save(`${player.name.replace(/[^a-z0-9]+/gi, "-")}-stats.pdf`);
}