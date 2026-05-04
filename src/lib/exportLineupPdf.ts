import jsPDF from "jspdf";
import autoTable, { type CellHookData } from "jspdf-autotable";

import {
  benchCount,
  playerNameById,
  sortLineupRows,
  type SavedLineup,
} from "@/lib/lineup";

import {
  battingAverage,
  fmt3,
  onBasePercentage,
  ops,
  type Player,
} from "@/lib/roster";

function lastTableY(doc: jsPDF, fallback: number): number {
  return (
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
      ?.finalY ?? fallback
  );
}

function playerById(players: Player[], playerId: string): Player | null {
  return players.find((player) => player.id === playerId) ?? null;
}

export function exportLineupPdf(opts: {
  teamName: string;
  seasonLabel: string;
  lineup: SavedLineup;
  players: Player[];
  includeStats?: boolean;
}) {
  const { teamName, seasonLabel, lineup, players, includeStats = true } = opts;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 32;

  doc.setFontSize(18);
  doc.text("Batting Lineup", marginX, 36);

  doc.setFontSize(10);
  doc.text(`${teamName} • ${seasonLabel}`, marginX, 54);

  doc.setFontSize(8);
  doc.text(
    `Generated: ${new Date().toLocaleDateString()}`,
    pageWidth - 150,
    36,
  );

  const inningKeys = Array.from({ length: lineup.inningCount }, (_, i) =>
    String(i + 1),
  );

  const sortedRows = sortLineupRows(lineup.rows);

  autoTable(doc, {
    startY: 76,
    margin: { left: marginX, right: marginX },
    head: [["#", "Player", ...inningKeys, "Bench"]],
    body: sortedRows.map((row, index) => [
      String(index + 1),
      playerNameById(players, row.playerId),
      ...inningKeys.map((inning) => row.innings[inning] || "—"),
      String(benchCount(row)),
    ]),
    theme: "grid",
    styles: {
      fontSize: 8,
      cellPadding: 4,
      minCellHeight: 17,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: 20,
      fontStyle: "bold",
      fontSize: 8,
      halign: "center",
    },
    columnStyles: {
      0: { cellWidth: 24, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 120, fontStyle: "bold" },
      [inningKeys.length + 2]: {
        cellWidth: 36,
        halign: "center",
        fontStyle: "bold",
      },
    },
    didParseCell: (data: CellHookData) => {
      if (data.section !== "body") return;

      const text = String(data.cell.raw ?? "");

      if (
        data.column.index >= 2 &&
        data.column.index <= inningKeys.length + 1
      ) {
        data.cell.styles.halign = "center";

        if (text === "BENCH") {
          data.cell.styles.fillColor = [238, 238, 238];
          data.cell.styles.textColor = [95, 95, 95];
          data.cell.styles.fontStyle = "bold";
        } else if (text !== "—") {
          data.cell.styles.fillColor = [255, 244, 220];
          data.cell.styles.textColor = [20, 20, 20];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  if (includeStats) {
    autoTable(doc, {
      startY: lastTableY(doc, 250) + 16,
      margin: { left: marginX, right: marginX },
      head: [["#", "Player", "AVG", "OBP", "OPS", "H", "R", "RBI", "BB", "SB"]],
      body: sortedRows.map((row, index) => {
        const player = playerById(players, row.playerId);

        if (!player) {
          return [
            String(index + 1),
            "Unknown Player",
            "—",
            "—",
            "—",
            "—",
            "—",
            "—",
            "—",
            "—",
          ];
        }

        return [
          String(index + 1),
          player.name,
          fmt3(battingAverage(player)),
          fmt3(onBasePercentage(player)),
          fmt3(ops(player)),
          String(player.stats.hits),
          String(player.stats.runs),
          String(player.stats.rbi),
          String(player.stats.walks),
          String(player.stats.stolenBases),
        ];
      }),
      theme: "grid",
      styles: {
        fontSize: 7.5,
        cellPadding: 3,
        minCellHeight: 14,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [230, 230, 230],
        textColor: 20,
        fontStyle: "bold",
        fontSize: 7.5,
        halign: "center",
      },
      columnStyles: {
        0: { cellWidth: 24, halign: "center", fontStyle: "bold" },
        1: { cellWidth: 118, fontStyle: "bold" },
        2: { halign: "center" },
        3: { halign: "center" },
        4: { halign: "center" },
        5: { halign: "center" },
        6: { halign: "center" },
        7: { halign: "center" },
        8: { halign: "center" },
        9: { halign: "center" },
      },
    });
  }

  doc.setFontSize(7);

  doc.save(
    `${teamName.replace(/[^a-z0-9]+/gi, "-")}-lineup${
      includeStats ? "-with-stats" : ""
    }.pdf`,
  );
}
