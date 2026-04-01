import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  battingAverage,
  onBasePercentage,
  slugging,
  ops,
  fmt3,
} from "@/lib/roster";
import type { Player } from "@/lib/roster";
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

  doc.setFontSize(18);
  doc.text(`${teamName} — Leaderboard`, 40, 40);

  doc.setFontSize(11);
  doc.text(
    `${seasonLabel}   |   Record: ${record.wins}-${record.losses}${
      record.ties ? `-${record.ties}` : ""
    }`,
    40,
    58,
  );

  doc.setFontSize(9);
  doc.text(
    `Generated: ${new Date().toLocaleDateString()}`,
    pageWidth - 150,
    40,
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
      "P-K",
    ],
  ];

  const rows = players.map((p) => {
    const ba = battingAverage(p);
    const obp = onBasePercentage(p);
    const slgV = slugging(p);
    const opsV = ops(p);

    const extendedStats = p.stats as unknown as {
      pitchingStrikeouts?: number;
    };

    return [
      p.number,
      p.name,
      fmt3(ba),
      fmt3(obp),
      fmt3(slgV),
      fmt3(opsV),
      p.stats.hits,
      p.stats.atBats,
      p.stats.rbi,
      p.stats.runs,
      p.stats.walks,
      p.stats.hitByPitch,
      p.stats.doubles,
      p.stats.triples,
      p.stats.homeRuns,
      extendedStats.pitchingStrikeouts ?? 0,
    ];
  });

  autoTable(doc, {
    startY: 70,
    head,
    body: rows,
    styles: {
      fontSize: 9,
      halign: "center",
      cellPadding: 4,
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: 20,
      fontStyle: "bold",
    },
    columnStyles: {
      1: { halign: "left", cellWidth: 140 },
    },
    didParseCell: (data) => {
      const rowIndex = data.row.index;
      const player = players[rowIndex];
      if (!player) return;

      const statMap: Array<string | null> = [
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
        null,
        null,
        null,
        null,
        null,
        null,
      ];

      const statKey = statMap[data.column.index];
      if (!statKey) return;

      if (leaders[statKey]?.includes(player.id)) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [255, 245, 210];
      }
    },
  });

  if (awards.length > 0) {
    const trophyRows = awards.map((award) => [
      award.trophy.title,
      award.winner.name,
      award.valueLabel,
      award.valueSub ?? "",
    ]);

    autoTable(doc, {
      startY:
        ((doc as unknown as { lastAutoTable?: { finalY?: number } })
          .lastAutoTable?.finalY ?? 70) + 24,
      head: [["Current Trophy Leaders", "Player", "Lead", "Notes"]],
      body: trophyRows,
      styles: {
        fontSize: 9,
        cellPadding: 4,
      },
      headStyles: {
        fillColor: [230, 230, 230],
        textColor: 20,
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 160 },
        1: { cellWidth: 120 },
        2: { cellWidth: 70, halign: "center" },
        3: { cellWidth: 220 },
      },
    });
  }

  doc.save(`${teamName}-leaderboard.pdf`);
}
