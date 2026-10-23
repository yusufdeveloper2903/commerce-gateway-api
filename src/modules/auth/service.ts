import type { DummyJsonClient } from '../../http/dummyjson-client.js';
import type { UserProfile } from '../users/schemas.js';

/**
 * Verifies credentials against the upstream identity provider. The upstream
 * tokens are deliberately discarded: clients only ever see the gateway's own
 * short-lived JWT, so the upstream can change without breaking clients.
 */
export class AuthService {
  constructor(private readonly client: DummyJsonClient) {}

  async verifyCredentials(username: string, password: string): Promise<UserProfile> {
    const u = await this.client.login(username, password);
    return {
      id: u.id,
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      fullName: `${u.firstName} ${u.lastName}`,
      email: u.email,
      image: u.image ?? null,
    };
  }
}
