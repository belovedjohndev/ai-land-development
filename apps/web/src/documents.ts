import {
  apiUrl,
  authenticatedFetch,
  AuthenticationRequiredError,
} from "./auth";

export const maxDocumentSizeBytes = 10 * 1024 * 1024;
export const supportedDocumentTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type DocumentCategory = {
  id: string;
  code: string;
  name: string;
  checklistItemCode: string;
};

export type DocumentVersion = {
  id: string;
  version: number;
  filename: string;
  mimeType: (typeof supportedDocumentTypes)[number];
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
};

export type ApplicationDocument = {
  id: string;
  applicationId: string;
  category: DocumentCategory;
  currentVersion: number;
  createdAt: string;
  versions: DocumentVersion[];
};

export async function loadDocumentCategories(
  signal?: AbortSignal,
): Promise<DocumentCategory[]> {
  const response = await authenticatedFetch("/api/document-categories", {
    signal,
  });
  if (!response.ok) throw new Error("Document categories could not be loaded.");
  return (await response.json()) as DocumentCategory[];
}

export async function loadDocuments(
  applicationId: string,
  signal?: AbortSignal,
): Promise<ApplicationDocument[]> {
  const response = await authenticatedFetch(
    `/api/applications/${applicationId}/documents`,
    { signal },
  );
  if (!response.ok) throw new Error("Document history could not be loaded.");
  return (await response.json()) as ApplicationDocument[];
}

export function uploadDocument(
  applicationId: string,
  categoryId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<ApplicationDocument> {
  const body = new FormData();
  body.append("categoryId", categoryId);
  body.append("file", file);

  return sendMultipart(
    `/api/applications/${applicationId}/documents`,
    body,
    onProgress,
  );
}

function sendMultipart(
  path: string,
  body: FormData,
  onProgress: (percent: number) => void,
): Promise<ApplicationDocument> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${apiUrl}${path}`);
    request.withCredentials = true;
    request.setRequestHeader("Idempotency-Key", crypto.randomUUID());
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if (request.status === 401) {
        reject(new AuthenticationRequiredError());
        return;
      }
      const payload = parseJson(request.responseText);
      if (request.status < 200 || request.status >= 300) {
        reject(
          new Error(
            payload && typeof payload.message === "string"
              ? payload.message
              : "Document upload failed.",
          ),
        );
        return;
      }
      resolve(payload as ApplicationDocument);
    });
    request.addEventListener("error", () => {
      reject(new Error("Document upload could not reach the API."));
    });
    request.send(body);
  });
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
