// /teams/** — permanent team routes (see src/lib/teamRoutes.ts). One shell
// is prerendered; Hosting rewrites every /teams/** path to it
// (firebase.tallies.json) and the client reads the real path.
import TeamRouteView from "./TeamRouteView";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ path: [] }];
}

export default function TeamsPage() {
  return <TeamRouteView />;
}
