import { z } from 'zod';

/** The renderer-facing OAuth status for a profile — redacted: no token or
 *  client-secret material, just whether we're signed in and until when. */
export const oauthStatusSchema = z.object({
  state: z.enum(['signed-out', 'signed-in', 'expired']),
  /** Epoch ms the access token expires (null if unknown / not signed in). */
  expiresAt: z.number().nullable(),
  /** The granted scope, if the token response carried one. */
  scope: z.string().nullable(),
});
export type OAuthStatus = z.infer<typeof oauthStatusSchema>;
