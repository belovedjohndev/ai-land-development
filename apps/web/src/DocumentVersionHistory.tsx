import { useState, type ChangeEvent, type FormEvent } from "react";
import { Archive, FileText, History, RefreshCw } from "lucide-react";
import { AuthenticationRequiredError } from "./auth";
import {
  archiveDocument,
  replaceDocument,
  validateDocumentFile,
  type ApplicationDocument,
} from "./documents";

type DocumentVersionHistoryProps = {
  document: ApplicationDocument;
  canManage: boolean;
  onArchived: (documentId: string) => void;
  onAuthenticationRequired: () => void;
  onUpdated: (document: ApplicationDocument) => void;
};

export function DocumentVersionHistory({
  document,
  canManage,
  onArchived,
  onAuthenticationRequired,
  onUpdated,
}: DocumentVersionHistoryProps) {
  const [replacement, setReplacement] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function selectReplacement(event: ChangeEvent<HTMLInputElement>) {
    setError("");
    setProgress(0);
    setReplacement(event.target.files?.[0] ?? null);
  }

  async function submitReplacement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const validationError = validateDocumentFile(replacement);
    if (validationError || !replacement) {
      setError(validationError ?? "Choose a file.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      onUpdated(
        await replaceDocument(
          document.applicationId,
          document.id,
          replacement,
          setProgress,
        ),
      );
      setReplacement(null);
      setProgress(100);
      const input = form.elements.namedItem(`replacement-${document.id}`);
      if (input instanceof HTMLInputElement) input.value = "";
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (
      !window.confirm(
        "Archive this document? Its versions will remain immutable but will no longer be available for download.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await archiveDocument(document.applicationId, document.id);
      onArchived(document.id);
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  }

  function handleError(caught: unknown) {
    if (caught instanceof AuthenticationRequiredError) {
      onAuthenticationRequired();
      return;
    }
    setError(
      caught instanceof Error ? caught.message : "Document action failed.",
    );
  }

  return (
    <article className="document-history">
      <header>
        <div className="document-title">
          <FileText aria-hidden="true" />
          <div>
            <strong>{document.category.name}</strong>
            <span>
              {document.category.checklistItemCode.replaceAll("_", " ")}
            </span>
          </div>
        </div>
        <span className="version-count">
          <History size={13} aria-hidden="true" />
          {document.versions.length} version
          {document.versions.length === 1 ? "" : "s"}
        </span>
      </header>
      <ol
        className="version-list"
        aria-label={`${document.category.name} versions`}
      >
        {[...document.versions].reverse().map((version) => (
          <li key={version.id}>
            <div>
              <strong>{version.filename}</strong>
              <span>
                {formatBytes(version.sizeBytes)} · {version.mimeType} · Uploaded
                by {version.uploadedBy}
              </span>
              <time dateTime={version.createdAt}>
                {new Date(version.createdAt).toLocaleString()}
              </time>
            </div>
            {version.version === document.currentVersion ? (
              <span className="current-version">
                Current · v{version.version}
              </span>
            ) : (
              <span className="past-version">v{version.version}</span>
            )}
          </li>
        ))}
      </ol>
      {canManage && (
        <form className="replacement-form" onSubmit={submitReplacement}>
          <label htmlFor={`replacement-${document.id}`}>
            Replace with a new immutable version
          </label>
          <input
            id={`replacement-${document.id}`}
            name={`replacement-${document.id}`}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            disabled={busy}
            required
            onChange={selectReplacement}
          />
          {busy && progress > 0 && (
            <div className="upload-progress" aria-live="polite">
              <progress max="100" value={progress} />
              <span>{progress}% uploaded</span>
            </div>
          )}
          <div className="document-actions">
            <button className="secondary" disabled={busy}>
              <RefreshCw size={14} aria-hidden="true" />
              {busy ? "Working…" : "Add version"}
            </button>
            <button
              className="archive-button"
              type="button"
              disabled={busy}
              onClick={archive}
            >
              <Archive size={14} aria-hidden="true" />
              Archive
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="document-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KiB`;
  return `${value} bytes`;
}
