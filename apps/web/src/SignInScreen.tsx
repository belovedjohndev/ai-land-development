import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { signIn, type SessionView } from "./auth";

type SignInScreenProps = {
  onSignedIn: (session: SessionView) => void;
};

export function SignInScreen({ onSignedIn }: SignInScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      onSignedIn(await signIn(email, password));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Sign-in failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="sign-in-page">
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <div className="sign-in-brand" aria-hidden="true">
          LD
        </div>
        <span className="eyebrow">AI Land Review Portal</span>
        <h1 id="sign-in-title">Sign in to your tenant</h1>
        <p>
          Use the account issued by your land development review administrator.
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1_024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && (
            <p className="sign-in-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary sign-in-submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="sign-in-policy">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            Sessions are stored securely and official decisions remain under
            authorized human control.
          </span>
        </div>
      </section>
    </main>
  );
}
