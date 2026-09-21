import { SignUp } from "@clerk/nextjs";
import AuthShell from "@/components/auth/AuthShell";

export default function SignUpPage() {
  return (
    <AuthShell
      title="Start with FollowUp AI"
      subtitle="Log a meeting and the AI turns it into dated follow-ups you won't forget."
    >
      <SignUp />
    </AuthShell>
  );
}
