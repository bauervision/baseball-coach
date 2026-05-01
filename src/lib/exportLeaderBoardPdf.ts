import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  battingAverage,
  onBasePercentage,
  slugging,
  ops,
  fmt3,
} from "@/lib/roster";
import type { Player, StatKey } from "@/lib/roster";
import type { TrophyAward } from "@/lib/trophies";

export function exportLeaderboardPdf(opts: {
  teamName: string;
  seasonLabel: string;
  record: { wins: number; losses: number; ties?: number };
  players: Player[];
  leaders: Record<string, string[]>;
  awards?: TrophyAward[];
}) {
  const { teamName, seasonLabel, record, players, leaders, awards = [] } = opts;

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "letter",
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(16);
  doc.text(`${teamName} — Leaderboard`, 32, 34);

  doc.setFontSize(10);
  doc.text(
    `${seasonLabel} | Record: ${record.wins}-${record.losses}${
      record.ties ? `-${record.ties}` : ""
    }`,
    32,
    50,
  );

  doc.setFontSize(8);
  doc.text(
    `Generated: ${new Date().toLocaleDateString()}`,
    pageWidth - 132,
    34,
  );

  const head = [
    [
      "#",
      "Name",
      "AVG",
      "OBP",
      "SLG",
      "OPS",
      "H",
      "AB",
      "RBI",
      "R",
      "BB",
      "HBP",
      "2B",
      "3B",
      "HR",
      "SB",
      "PO",
      "A",
      "P-K",
    ],
  ];

  const rows = players.map((p) => [
    p.number,
    p.name,
    fmt3(battingAverage(p)),
    fmt3(onBasePercentage(p)),
    fmt3(slugging(p)),
    fmt3(ops(p)),
    p.stats.hits,
    p.stats.atBats,
    p.stats.rbi,
    p.stats.runs,
    p.stats.walks,
    p.stats.hitByPitch,
    p.stats.doubles,
    p.stats.triples,
    p.stats.homeRuns,
    p.stats.stolenBases,
    p.stats.putOuts,
    p.stats.assists,
    p.stats.pitchingStrikeouts,
  ]);

  const statMap: Array<StatKey | null> = [
    null,
    null,
    "avg",
    "obp",
    "slg",
    "ops",
    "hits",
    "atBats",
    "rbi",
    "runs",
    "walks",
    "hitByPitch",
    "doubles",
    "triples",
    "homeRuns",
    null,
    null,
    null,
    "pitchingStrikeouts",
  ];

  autoTable(doc, {
    startY: 62,
    head,
    body: rows,
    margin: { left: 28, right: 28 },
    theme: "grid",
    styles: {
      fontSize: 7,
      halign: "center",
      cellPadding: 2,
      overflow: "linebreak",
      minCellHeight: 14,
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: 20,
      fontStyle: "bold",
      fontSize: 7,
    },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { halign: "left", cellWidth: 108 },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;

      const player = players[data.row.index];
      if (!player) return;

      const statKey = statMap[data.column.index];
      if (!statKey) return;

      if (leaders[statKey]?.includes(player.id)) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [255, 245, 210];
      }
    },
  });

  if (awards.length > 0) {
    const finalY =
      ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
        ?.finalY ?? 70) + 18;

    const rowsByPlayer = players.map((player) => {
      const leaderAwards = awards.filter((award) =>
        award.leaders.some((leader) => leader.id === player.id),
      );

      const runnerUpAwards = awards.filter(
        (award) => award.runnerUp?.id === player.id,
      );

      const leadText =
        leaderAwards.length > 0
          ? leaderAwards.map((award) => award.trophy.title).join(", ")
          : "—";

      const runnerUpText =
        runnerUpAwards.length > 0
          ? runnerUpAwards.map((award) => award.trophy.title).join(", ")
          : "—";

      return [player.number, player.name, leadText, runnerUpText];
    });

    autoTable(doc, {
      startY: finalY,
      margin: { left: 28, right: 28 },
      head: [["#", "Player", "Trophy Leads", "Runner-Up In"]],
      body: rowsByPlayer,
      theme: "grid",
      styles: {
        fontSize: 6.5,
        cellPadding: 2,
        minCellHeight: 12,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [230, 230, 230],
        textColor: 20,
        fontStyle: "bold",
        fontSize: 7,
      },
      columnStyles: {
        0: { cellWidth: 24, halign: "center" },
        1: { cellWidth: 120 },
        2: { cellWidth: 330 },
        3: { cellWidth: 300 },
      },
    });
  }
  while (doc.getNumberOfPages() > 1) {
    doc.deletePage(doc.getNumberOfPages());
  }

  doc.save(`${teamName}-leaderboard.pdf`);
}
