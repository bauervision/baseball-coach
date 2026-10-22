// Read-only identity audit. Writes a report and an approval template; never
// writes to Firestore.
//
//   node tools/identity-audit.mjs --from-json backup.json --out-dir audit/
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 \
//     node tools/identity-audit.mjs --project demo-baseball-coach --out-dir audit/
//
// Reading production requires --allow-production-read (prefer auditing an
// export made with tools/export-firestore.mjs).
import fs from "node:fs";
import path from "node:path";
import { arg, assertOutsideRepo, connect, loadSnapshot, toJson } from "./identity/firestore.mjs";
import { approvalTemplate, auditIdentities } from "./identity/audit.mjs";

try {
  const outDir = arg("--out-dir");
  if (!outDir) throw new Error("Pass --out-dir <directory>.");
  assertOutsideRepo(outDir);

  const fromJson = arg("--from-json");
  const snapshot = fromJson
    ? JSON.parse(fs.readFileSync(fromJson, "utf8"))
    : toJson(await loadSnapshot(connect({ productionFlag: "--allow-production-read" }).db));

  const report = auditIdentities(snapshot);
  const generatedAt = new Date().toISOString();
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "identity-audit.json");
  const approvalsPath = path.join(outDir, "identity-approvals.json");
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt, ...report }, null, 2));
  if (fs.existsSync(approvalsPath)) {
    console.log(`Kept existing ${approvalsPath} (not overwriting coach decisions).`);
  } else {
    fs.writeFileSync(
      approvalsPath,
      JSON.stringify(approvalTemplate(report, generatedAt), null, 2),
    );
  }

  const s = report.summary;
  console.log(
    `Seasons ${s.seasons} · roster entries ${s.rosterEntries} (confirmed ${s.confirmed}, unreviewed ${s.unreviewed})`,
  );
  console.log(
    `Proposals ${s.proposals} · conflicts ${s.conflicts} · missing ids ${s.missingCareerId} · orphan game lines ${s.orphanLines}`,
  );
  for (const r of report.returningPlayers) {
    console.log(`  returning? ${r.displayName}: ${r.seasons.join(" → ")} [${r.proposalId}]`);
  }
  console.log(`Report: ${reportPath}\nApprovals (all pending): ${approvalsPath}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
