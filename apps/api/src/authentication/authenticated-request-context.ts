import type { AuthenticatedRequestContext } from "../types.js";
import type { AuthenticationService } from "./authentication-service.js";

export class AuthenticatedRequestContextResolver {
  constructor(private readonly authentication: AuthenticationService) {}

  async resolve(
    sessionToken: string | undefined,
  ): Promise<AuthenticatedRequestContext | null> {
    const session = await this.authentication.getSession(sessionToken);
    if (!session) return null;

    return {
      tenantId: session.tenant.id,
      actorId: session.user.id,
      role: session.user.role,
    };
  }
}
