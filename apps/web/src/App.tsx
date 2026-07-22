import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  MapPinned,
  ShieldCheck,
} from "lucide-react";
import {
  authenticatedFetch,
  AuthenticationRequiredError,
  getSession,
  type SessionView,
} from "./auth";
import { AuthenticatedShell } from "./AuthenticatedShell";
import { DocumentManager } from "./DocumentManager";
import { SignInScreen } from "./SignInScreen";

type Finding = {
  id: string;
  source: "ai" | "deterministic_rule" | "reviewer";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  resolved: boolean;
};
type Audit = {
  id: string;
  at: string;
  actor: string;
  event: string;
  detail: string;
};
type Application = {
  id: string;
  referenceNo: string;
  applicantName: string;
  parcelNo: string;
  developmentType: string;
  region: string;
  status: string;
  assignedOfficer: string;
  score: number;
  findings: Finding[];
  documents: { name: string; meta: string }[];
  audit: Audit[];
};

const labels: Record<string, string> = {
  under_review: "Under Review",
  ai_prescreened: "AI Pre-Screened",
  needs_revision: "Needs Revision",
  approved: "Approved",
  rejected: "Rejected",
  submitted: "Submitted",
  draft: "Draft",
};

export default function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [authNotice, setAuthNotice] = useState("");
  const [items, setItems] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Application | null>(null);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState("");
  const [message, setMessage] = useState("");

  const expireSession = useCallback(() => {
    setSession(null);
    setItems([]);
    setSelected(null);
    setAuthNotice("Your session expired. Sign in again to continue.");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function restoreSession() {
      try {
        setSession(await getSession(controller.signal));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setAuthNotice(
          error instanceof Error
            ? error.message
            : "The current session could not be checked.",
        );
      } finally {
        if (!controller.signal.aborted) setCheckingSession(false);
      }
    }
    void restoreSession();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const response = await authenticatedFetch("/api/applications", {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error("The application queue could not be loaded.");
        const data = await response.json();
        if (!controller.signal.aborted) setItems(data);
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) {
          expireSession();
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "The application queue could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [expireSession, session]);
  const metrics = useMemo(
    () => ({
      submitted: items.length,
      review: items.filter((x) => x.status === "under_review").length,
      revision: items.filter((x) => x.status === "needs_revision").length,
      flags: items.reduce(
        (n, x) => n + x.findings.filter((f) => !f.resolved).length,
        0,
      ),
    }),
    [items],
  );

  async function decide(
    action: "approve" | "request_revision" | "reject" | "override",
  ) {
    if (!selected) return;
    setMessage("");
    const payload = {
      action,
      note: note || "Reviewer completed the application assessment.",
      ...(action === "override" ? { overrideJustification: override } : {}),
    };
    try {
      const response = await authenticatedFetch(
        `/api/applications/${selected.id}/decisions`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.message ?? "Decision failed.");
      }
      const updated = await response.json();
      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelected(updated);
      setNote("");
      setOverride("");
      setMessage(
        "Decision recorded in PostgreSQL and appended to the audit trail.",
      );
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        expireSession();
        return;
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "Decision failed. Start the API or verify the form.",
      );
    }
  }

  if (checkingSession) {
    return (
      <main className="session-check" aria-live="polite">
        <div className="brand-mark">LD</div>
        <p>Checking your session…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <SignInScreen
        notice={authNotice}
        onSignedIn={(activeSession) => {
          setSession(activeSession);
          setAuthNotice("");
        }}
      />
    );
  }

  return (
    <AuthenticatedShell
      session={session}
      onShowDashboard={() => setSelected(null)}
      onSignedOut={() => {
        setSession(null);
        setItems([]);
        setSelected(null);
        setAuthNotice("");
      }}
    >
      {loadError && (
        <section className="card">
          <p className="message">{loadError}</p>
        </section>
      )}
      {loading ? (
        <section className="card">
          <p>Loading tenant-scoped application data…</p>
        </section>
      ) : selected ? (
        <ApplicationWorkspace
          item={selected}
          note={note}
          setNote={setNote}
          override={override}
          setOverride={setOverride}
          decide={decide}
          canDecide={session.user.role !== "viewer"}
          role={session.user.role}
          onAuthenticationRequired={expireSession}
          message={message}
          close={() => setSelected(null)}
        />
      ) : (
        <Dashboard
          items={items}
          metrics={metrics}
          open={(item) => {
            setSelected(item);
            setMessage("");
          }}
        />
      )}
    </AuthenticatedShell>
  );
}

function Dashboard({
  items,
  metrics,
  open,
}: {
  items: Application[];
  metrics: {
    submitted: number;
    review: number;
    revision: number;
    flags: number;
  };
  open: (x: Application) => void;
}) {
  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Planning operations</span>
          <h1>Reviewer Dashboard</h1>
          <p>
            Prioritize applications, inspect policy risks, and keep every
            decision traceable.
          </p>
        </div>
        <button className="primary">New application</button>
      </header>
      <section className="metrics">
        <Metric
          label="Submitted"
          value={metrics.submitted}
          hint="Current queue"
          icon={<Building2 />}
        />
        <Metric
          label="Under review"
          value={metrics.review}
          hint="Assigned to officers"
          icon={<ClipboardCheck />}
        />
        <Metric
          label="Needs revision"
          value={metrics.revision}
          hint="Applicant action needed"
          icon={<AlertTriangle />}
        />
        <Metric
          label="Open findings"
          value={metrics.flags}
          hint="AI and policy checks"
          icon={<Gauge />}
        />
      </section>
      <section className="card table-card">
        <div className="card-head">
          <div>
            <h2>Application review queue</h2>
            <p>All regions · open statuses</p>
          </div>
          <span className="tag">Live operational view</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Application</th>
                <th>Applicant</th>
                <th>Development</th>
                <th>Region</th>
                <th>Findings</th>
                <th>Status</th>
                <th>Officer</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.referenceNo}</strong>
                    <small>{item.parcelNo}</small>
                  </td>
                  <td>{item.applicantName}</td>
                  <td>{item.developmentType}</td>
                  <td>{item.region}</td>
                  <td>
                    <span
                      className={`risk ${item.findings.some((f) => f.severity === "critical") ? "critical" : item.findings.length ? "warning" : "clear"}`}
                    >
                      {item.findings.length
                        ? `${item.findings.length} open`
                        : "Clear"}
                    </span>
                  </td>
                  <td>
                    <span className={`status ${item.status}`}>
                      {labels[item.status]}
                    </span>
                  </td>
                  <td>{item.assignedOfficer}</td>
                  <td>
                    <button className="secondary" onClick={() => open(item)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Metric({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="card metric">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function ApplicationWorkspace({
  item,
  note,
  setNote,
  override,
  setOverride,
  decide,
  canDecide,
  role,
  onAuthenticationRequired,
  message,
  close,
}: {
  item: Application;
  note: string;
  setNote: (v: string) => void;
  override: string;
  setOverride: (v: string) => void;
  decide: (a: "approve" | "request_revision" | "reject" | "override") => void;
  canDecide: boolean;
  role: SessionView["user"]["role"];
  onAuthenticationRequired: () => void;
  message: string;
  close: () => void;
}) {
  return (
    <>
      <header className="page-head detail-head">
        <div>
          <button className="back" onClick={close}>
            ← Back to queue
          </button>
          <span className="eyebrow">{item.referenceNo}</span>
          <h1>{item.developmentType}</h1>
          <p>
            {item.applicantName} · Parcel {item.parcelNo} · {item.region}
          </p>
        </div>
        <span className={`status large ${item.status}`}>
          {labels[item.status]}
        </span>
      </header>
      <section className="workspace-grid">
        <div className="workspace-main">
          <section className="card overview">
            <div className="score">
              <div
                className="score-ring"
                style={
                  { "--score": `${item.score * 3.6}deg` } as React.CSSProperties
                }
              >
                <div>
                  <strong>{item.score}</strong>
                  <span>Review score</span>
                </div>
              </div>
            </div>
            <div>
              <span className="eyebrow">Pre-screening summary</span>
              <h2>
                {item.findings.length
                  ? `${item.findings.length} findings require review`
                  : "No material gaps detected"}
              </h2>
              <p>
                The score combines completeness checks and deterministic policy
                checks. AI observations remain advisory.
              </p>
              <div className="summary-grid">
                <Summary
                  label="Assigned officer"
                  value={item.assignedOfficer}
                />
                <Summary label="Current region" value={item.region} />
                <Summary
                  label="Documents"
                  value={`${item.documents.length} uploaded`}
                />
                <Summary
                  label="Policy result"
                  value={
                    item.findings.some((f) => f.source === "deterministic_rule")
                      ? "Action required"
                      : "No blocking rule"
                  }
                />
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Compliance findings</h2>
                <p>Source and severity are explicit for every finding.</p>
              </div>
            </div>
            <div className="findings">
              {item.findings.length ? (
                item.findings.map((f) => (
                  <article className={`finding ${f.severity}`} key={f.id}>
                    <div className="finding-icon">
                      {f.severity === "critical" ? (
                        <AlertTriangle />
                      ) : (
                        <CheckCircle2 />
                      )}
                    </div>
                    <div>
                      <div className="finding-meta">
                        <span>
                          {f.source === "ai"
                            ? "AI suggestion"
                            : f.source === "deterministic_rule"
                              ? "Deterministic policy"
                              : "Reviewer finding"}
                        </span>
                        <b>{f.severity}</b>
                      </div>
                      <h3>{f.title}</h3>
                      <p>{f.detail}</p>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty">
                  <CheckCircle2 />
                  <strong>No open findings</strong>
                  <span>
                    The application can proceed to human confirmation.
                  </span>
                </div>
              )}
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Audit trail</h2>
                <p>Append-only reviewer and system activity.</p>
              </div>
            </div>
            <div className="audit">
              {item.audit.map((a) => (
                <div className="audit-row" key={a.id}>
                  <span>{a.at.replace("T", " ").slice(0, 16)}</span>
                  <div>
                    <strong>{a.event}</strong>
                    <p>{a.detail}</p>
                  </div>
                  <b>{a.actor}</b>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="workspace-side">
          <section className="card map-card">
            <div className="card-head">
              <div>
                <h2>Parcel context</h2>
                <p>Prototype spatial reference</p>
              </div>
              <MapPinned size={20} />
            </div>
            <div className="map">
              <div className="parcel p1"></div>
              <div className="parcel p2"></div>
              <div className="road">Municipal access road</div>
            </div>
          </section>
          {canDecide ? (
            <section className="card decision">
              <div className="card-head">
                <div>
                  <h2>Reviewer decision</h2>
                  <p>All actions are attributable.</p>
                </div>
              </div>
              <label>
                Review note
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Record evidence checked and the basis for the decision."
                />
              </label>
              <div className="decision-buttons">
                <button className="approve" onClick={() => decide("approve")}>
                  Approve
                </button>
                <button
                  className="revise"
                  onClick={() => decide("request_revision")}
                >
                  Request revision
                </button>
                <button className="reject" onClick={() => decide("reject")}>
                  Reject
                </button>
              </div>
              <label>
                Override justification
                <textarea
                  value={override}
                  onChange={(e) => setOverride(e.target.value)}
                  placeholder="Required when overriding an AI or policy finding."
                />
              </label>
              <button
                className="secondary full"
                onClick={() => decide("override")}
              >
                Record manual override
              </button>
              {message && <p className="message">{message}</p>}
            </section>
          ) : (
            <section className="card viewer-notice">
              <ShieldCheck aria-hidden="true" />
              <div>
                <h2>Read-only access</h2>
                <p>
                  Viewers can inspect applications and audit history but cannot
                  submit decisions.
                </p>
              </div>
            </section>
          )}
          <DocumentManager
            applicationId={item.id}
            role={role}
            onAuthenticationRequired={onAuthenticationRequired}
          />
        </aside>
      </section>
    </>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
