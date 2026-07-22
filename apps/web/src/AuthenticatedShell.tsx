import { useState, type ReactNode } from "react";
import {
  ClipboardCheck,
  FileText,
  Gauge,
  LayoutDashboard,
  LogOut,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { signOut, type SessionView } from "./auth";

type AuthenticatedShellProps = {
  children: ReactNode;
  session: SessionView;
  onShowDashboard: () => void;
  onSignedOut: () => void;
};

export function AuthenticatedShell({
  children,
  session,
  onShowDashboard,
  onSignedOut,
}: AuthenticatedShellProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOut();
      onSignedOut();
    } catch (caught) {
      setSignOutError(
        caught instanceof Error
          ? caught.message
          : "Sign-out failed. Please try again.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">LD</div>
          <div>
            <strong>AI-LDMS</strong>
            <span>Land Review Portal</span>
          </div>
        </div>
        <nav aria-label="Application navigation">
          <button className="nav active" onClick={onShowDashboard}>
            <LayoutDashboard size={17} aria-hidden="true" />
            Reviewer Dashboard
          </button>
          <button className="nav">
            <FileText size={17} aria-hidden="true" />
            Applications
          </button>
          <button className="nav">
            <Gauge size={17} aria-hidden="true" />
            AI Pre-Screening
          </button>
          <button className="nav">
            <Scale size={17} aria-hidden="true" />
            Compliance Review
          </button>
          <button className="nav">
            <ClipboardCheck size={17} aria-hidden="true" />
            Reports
          </button>
        </nav>
        <section className="session-panel" aria-label="Signed-in account">
          <strong>{session.user.name}</strong>
          <span>{session.tenant.name}</span>
          <small>{session.user.role}</small>
          <button onClick={handleSignOut} disabled={signingOut}>
            <LogOut size={15} aria-hidden="true" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          {signOutError && (
            <p role="alert" className="session-error">
              {signOutError}
            </p>
          )}
        </section>
        <div className="policy-note">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Human-controlled decisions</strong>
            <span>
              AI findings are advisory and never finalize an application.
            </span>
          </div>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
