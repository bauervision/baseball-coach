// /signin — the Tallies coach sign-in. In Tallies mode the app frame renders
// it (src/components/auth/AuthOverlayWrapper.tsx); the legacy app has its own
// sign-in gate, so this route just returns home there.
import SignInEntry from "./SignInEntry";

export default function SignInPage() {
  return <SignInEntry />;
}
