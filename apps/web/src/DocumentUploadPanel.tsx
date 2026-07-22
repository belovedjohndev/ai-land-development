import { useState, type ChangeEvent, type FormEvent } from "react";
import { Upload } from "lucide-react";
import { AuthenticationRequiredError } from "./auth";
import {
  uploadDocument,
  validateDocumentFile,
  type ApplicationDocument,
  type DocumentCategory,
} from "./documents";

type DocumentUploadPanelProps = {
  applicationId: string;
  categories: DocumentCategory[];
  onAuthenticationRequired: () => void;
  onUploaded: (document: ApplicationDocument) => void;
};

export function DocumentUploadPanel({
  applicationId,
  categories,
  onAuthenticationRequired,
  onUploaded,
}: DocumentUploadPanelProps) {
  const [categoryId, setCategoryId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setError("");
    setProgress(0);
    setFile(event.target.files?.[0] ?? null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!categoryId || !file) {
      setError("Choose a category and a file.");
      return;
    }
    const validationError = validateDocumentFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const document = await uploadDocument(
        applicationId,
        categoryId,
        file,
        setProgress,
      );
      onUploaded(document);
      setFile(null);
      setProgress(100);
      const input = form.elements.namedItem("document-file");
      if (input instanceof HTMLInputElement) input.value = "";
    } catch (caught) {
      if (caught instanceof AuthenticationRequiredError) {
        onAuthenticationRequired();
        return;
      }
      setError(
        caught instanceof Error ? caught.message : "Document upload failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="document-upload" onSubmit={submit}>
      <label htmlFor="document-category">Document category</label>
      <select
        id="document-category"
        value={categoryId}
        required
        disabled={submitting}
        onChange={(event) => setCategoryId(event.target.value)}
      >
        <option value="">Select a checklist category</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <label htmlFor="document-file">File</label>
      <input
        id="document-file"
        name="document-file"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        required
        disabled={submitting}
        onChange={selectFile}
      />
      <small>PDF, JPEG, or PNG. Maximum 10 MiB.</small>
      {submitting && (
        <div className="upload-progress" aria-live="polite">
          <progress max="100" value={progress} />
          <span>{progress}% uploaded</span>
        </div>
      )}
      {error && (
        <p className="document-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary document-submit" disabled={submitting}>
        <Upload size={15} aria-hidden="true" />
        {submitting ? "Uploading…" : "Upload document"}
      </button>
    </form>
  );
}
