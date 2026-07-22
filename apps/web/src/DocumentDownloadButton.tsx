import { useState } from "react";
import { Download } from "lucide-react";
import { AuthenticationRequiredError } from "./auth";
import { requestDocumentDownload } from "./documents";

type DocumentDownloadButtonProps = {
  applicationId: string;
  documentId: string;
  filename: string;
  version: number;
  onAuthenticationRequired: () => void;
};

export function DocumentDownloadButton({
  applicationId,
  documentId,
  filename,
  version,
  onAuthenticationRequired,
}: DocumentDownloadButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      const signed = await requestDocumentDownload(
        applicationId,
        documentId,
        version,
      );
      const link = window.document.createElement("a");
      link.href = signed.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute(
        "aria-label",
        `Download ${filename} version ${version}`,
      );
      link.click();
    } catch (caught) {
      if (caught instanceof AuthenticationRequiredError) {
        onAuthenticationRequired();
        return;
      }
      setError(
        caught instanceof Error ? caught.message : "Document download failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="download-control">
      <button
        className="download-button"
        type="button"
        disabled={busy}
        aria-label={`Download ${filename} version ${version}`}
        onClick={download}
      >
        <Download size={13} aria-hidden="true" />
        {busy ? "Preparing…" : "Download"}
      </button>
      {error && (
        <span className="download-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
