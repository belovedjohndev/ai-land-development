export type UserRole = "admin" | "reviewer" | "viewer";

export type SessionView = {
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  };
  tenant: {
    id: string;
    name: string;
  };
  expiresAt: string;
};

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication required.");
    this.name = "AuthenticationRequiredError";
  }
}

export async function getSession(
  signal?: AbortSignal,
): Promise<SessionView | null> {
  const response = await fetch(`${apiUrl}/api/auth/session`, {
    credentials: "include",
    signal,
  });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error("The current session could not be checked.");
  }
  return (await response.json()) as SessionView;
}

export async function authenticatedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
  });
  if (response.status === 401) throw new AuthenticationRequiredError();
  return response;
}

export async function signIn(
  email: string,
  password: string,
): Promise<SessionView> {
  const response = await fetch(`${apiUrl}/api/auth/sign-in`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? "Sign-in failed. Please try again.");
  }

  return (await response.json()) as SessionView;
}

export async function signOut(): Promise<void> {
  const response = await fetch(`${apiUrl}/api/auth/sign-out`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Sign-out failed. Please try again.");
  }
}
