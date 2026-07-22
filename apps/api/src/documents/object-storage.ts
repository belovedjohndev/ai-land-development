export type StoredObject = {
  key: string;
  content: Buffer;
  contentType: string;
  sha256: string;
};

export type SignedDownload = {
  url: string;
  expiresAt: Date;
};

export interface ObjectStorage {
  putObject(object: StoredObject): Promise<void>;
  deleteObject(key: string): Promise<void>;
  createSignedDownload(
    key: string,
    filename: string,
    expiresInSeconds: number,
  ): Promise<SignedDownload>;
}
