import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Gauge,
  LayoutDashboard,
  MapPinned,
  Scale,
  ShieldCheck,
} from "lucide-react";

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

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
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
  const [items, setItems] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Application | null>(null);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`${apiUrl}/api/applications`);
        if (!response.ok)
          throw new Error("The application queue could not be loaded.");
        const data = await response.json();
        if (!cancelled) setItems(data);
      } catch (error) {
        if (!cancelled)
          setLoadError(
            error instanceof Error
              ? error.message
              : "The application queue could not be loaded.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
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
      const response = await fetch(
        `${apiUrl}/api/applications/${selected.id}/decisions`,
        {
          method: "POST",
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
      setMessage(
        error instanceof Error
          ? error.message
          : "Decision failed. Start the API or verify the form.",
      );
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
        <nav>
          <button className="nav active" onClick={() => setSelected(null)}>
            <LayoutDashboard size={17} />
            Reviewer Dashboard
          </button>
          <button className="nav">
            <FileText size={17} />
            Applications
          </button>
          <button className="nav">
            <Gauge size={17} />
            AI Pre-Screening
          </button>
          <button className="nav">
            <Scale size={17} />
            Compliance Review
          </button>
          <button className="nav">
            <ClipboardCheck size={17} />
            Reports
          </button>
        </nav>
        <div className="policy-note">
          <ShieldCheck size={18} />
          <div>
            <strong>Human-controlled decisions</strong>
            <span>
              AI findings are advisory and never finalize an application.
            </span>
          </div>
        </div>
      </aside>
      <main className="content">
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
      </main>
    </div>
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
  message,
  close,
}: {
  item: Application;
  note: string;
  setNote: (v: string) => void;
  override: string;
  setOverride: (v: string) => void;
  decide: (a: "approve" | "request_revision" | "reject" | "override") => void;
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
          <section className="card documents">
            <div className="card-head">
              <div>
                <h2>Documents</h2>
                <p>Versioned submission evidence</p>
              </div>
            </div>
            {item.documents.length ? (
              item.documents.map((d) => (
                <div className="doc" key={d.name}>
                  <FileText />
                  <div>
                    <strong>{d.name}</strong>
                    <span>{d.meta}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty small-empty">
                No document metadata in the demo record.
              </div>
            )}
          </section>
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
