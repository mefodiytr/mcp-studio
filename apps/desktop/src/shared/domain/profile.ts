import { z } from 'zod';

/**
 * A saved connection to an MCP server. The secret part of the auth config (the
 * Bearer token, the custom header's value) is *not* stored here — it lives in
 * the OS credential vault (C6), keyed by the profile id. This object only ever
 * holds the auth *method* (and, for `header`, the header name).
 */

export const profileTagsSchema = z.object({
  env: z.string().optional(),
  project: z.string().optional(),
});
export type ProfileTags = z.infer<typeof profileTagsSchema>;

export const authConfigSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('none') }),
  z.object({ method: z.literal('bearer') }),
  z.object({ method: z.literal('header'), headerName: z.string().min(1) }),
  // OAuth 2.1 + PKCE (http/sse only). `scope` is optional; `clientId` is only
  // needed for servers that don't support dynamic client registration — the
  // wizard surfaces that field after a first connect shows there's no
  // registration endpoint. No secret is stored here; tokens + DCR client info
  // live in the credential vault.
  z.object({
    method: z.literal('oauth'),
    scope: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
  }),
]);
export type AuthConfig = z.infer<typeof authConfigSchema>;

const profileBaseFields = z.object({
  name: z.string().min(1),
  auth: authConfigSchema,
  tlsInsecure: z.boolean().optional(),
  tlsInsecureReason: z.string().optional(),
  tags: profileTagsSchema.optional(),
});

const httpFields = z.object({
  transport: z.literal('http'),
  url: z.string().url(),
});

const stdioFields = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
});

const storedFields = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Input accepted when creating or updating a profile (no id/timestamps). */
export const profileInputSchema = z.discriminatedUnion('transport', [
  profileBaseFields.merge(httpFields),
  profileBaseFields.merge(stdioFields),
]);
export type ProfileInput = z.infer<typeof profileInputSchema>;

/** A stored profile: input plus id and timestamps. */
export const profileSchema = z.discriminatedUnion('transport', [
  profileBaseFields.merge(storedFields).merge(httpFields),
  profileBaseFields.merge(storedFields).merge(stdioFields),
]);
export type Profile = z.infer<typeof profileSchema>;
