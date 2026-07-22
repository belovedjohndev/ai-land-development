import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { AuthenticationRequiredError, type UserRole } from "./auth";
import {
  loadDocumentCategories,
  loadDocuments,
  type ApplicationDocument,
  type DocumentCategory,
} from "./documents";
import { DocumentUploadPanel } from "./DocumentUploadPanel";

type DocumentManagerProps = {
  applicationId: string;
  role: UserRole;
  onAuthenticationRequired: () => void;
};

export function DocumentManager({
  applicationId,
  role,
  onAuthenticationRequired,
}: DocumentManagerProps) {
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [documents, setDocuments] = useState<ApplicationDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [categoryData, documentData] = await Promise.all([
          loadDocumentCategories(controller.signal),
          loadDocuments(applicationId, controller.signal),
        ]);
        if (!controller.signal.aborted) {
          setCategories(categoryData);
          setDocuments(documentData);
        }
      } catch (caught) {
        if (caught instanceof AuthenticationRequiredError) {
          onAuthenticationRequired();
          return;
        }
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Documents could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [applicationId, onAuthenticationRequired]);

  function updateDocument(document: ApplicationDocument) {
    setDocuments((current) => {
      const exists = current.some((item) => item.id === document.id);
      return exists
        ? current.map((item) => (item.id === document.id ? document : item))
        : [...current, document];
    });
  }

  const canUpload = role === "admin" || role === "reviewer";

  return (
    <section className="card documents">
      <div className="card-head">
        <div>
          <h2>Documents</h2>
          <p>Private, versioned submission evidence</p>
        </div>
      </div>
      {canUpload && (
        <DocumentUploadPanel
          applicationId={applicationId}
          categories={categories}
          onAuthenticationRequired={onAuthenticationRequired}
          onUploaded={updateDocument}
        />
      )}
      {error && (
        <p className="document-error document-load-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="document-state" aria-live="polite">
          Loading document history…
        </p>
      ) : documents.length ? (
        <div className="document-list">
          {documents.map((document) => {
            const current = document.versions.find(
              (version) => version.version === document.currentVersion,
            );
            return (
              <article className="doc" key={document.id}>
                <FileText aria-hidden="true" />
                <div>
                  <strong>{current?.filename ?? document.category.name}</strong>
                  <span>
                    {document.category.name} · Version {document.currentVersion}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="document-state">No active documents.</p>
      )}
    </section>
  );
}
