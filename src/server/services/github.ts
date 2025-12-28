/**
 * GitHub Service
 * Validates tokens and fetches user relationships
 */

import { Octokit } from '@octokit/rest';

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
}

export class GitHubService {
  /**
   * Validate token and get user profile
   */
  async validateToken(token: string): Promise<GitHubUser | null> {
    try {
      const octokit = new Octokit({ auth: token });
      const { data } = await octokit.users.getAuthenticated();
      return {
        id: data.id,
        login: data.login,
        avatar_url: data.avatar_url,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get user's followers (IDs only for efficiency)
   */
  async getFollowers(token: string): Promise<number[]> {
    try {
      const octokit = new Octokit({ auth: token });
      const followers: number[] = [];

      for await (const response of octokit.paginate.iterator(
        octokit.users.listFollowersForAuthenticatedUser,
        { per_page: 100 }
      )) {
        for (const user of response.data) {
          followers.push(user.id);
        }
      }

      return followers;
    } catch {
      return [];
    }
  }

  /**
   * Get users that the authenticated user follows (IDs only)
   */
  async getFollowing(token: string): Promise<number[]> {
    try {
      const octokit = new Octokit({ auth: token });
      const following: number[] = [];

      for await (const response of octokit.paginate.iterator(
        octokit.users.listFollowingForAuthenticatedUser,
        { per_page: 100 }
      )) {
        for (const user of response.data) {
          following.push(user.id);
        }
      }

      return following;
    } catch {
      return [];
    }
  }

  /**
   * Get full relationship data
   */
  async getRelationships(token: string): Promise<{
    followers: number[];
    following: number[];
  }> {
    const [followers, following] = await Promise.all([
      this.getFollowers(token),
      this.getFollowing(token),
    ]);
    return { followers, following };
  }
}
