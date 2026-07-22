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
