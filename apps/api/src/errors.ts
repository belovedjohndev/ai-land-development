export type RepositoryErrorCode =
  | "INVALID_STATUS_TRANSITION"
  | "REVIEWER_NOT_IN_TENANT"
  | "CONCURRENT_MODIFICATION";

export class RepositoryError extends Error {
  constructor(
    public readonly code: RepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
