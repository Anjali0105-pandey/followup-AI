import { SignIn } from "@clerk/nextjs";
import AuthShell from "@/components/auth/AuthShell";

export default function SignInPage() {
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Pick up where you left off — your follow-ups are waiting."
    >
      <SignIn />
    </AuthShell>
  );
}
