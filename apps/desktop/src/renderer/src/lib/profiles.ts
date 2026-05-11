import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { Profile, ProfileInput } from '@shared/domain/profile';

const PROFILES_KEY = ['profiles'] as const;

function bridge(): NonNullable<typeof window.studio> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio;
}

export function useProfiles(): UseQueryResult<Profile[]> {
  return useQuery({ queryKey: PROFILES_KEY, queryFn: () => bridge().invoke('profiles:list', {}) });
}

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileInput) => bridge().invoke('profiles:create', { input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PROFILES_KEY }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProfileInput }) =>
      bridge().invoke('profiles:update', { id, input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PROFILES_KEY }),
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => bridge().invoke('profiles:delete', { id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PROFILES_KEY }),
  });
}

// Credential helpers — the renderer only ever sees the hint, never the secret.
export async function setCredential(profileId: string, secret: string): Promise<string> {
  return (await bridge().invoke('credentials:set', { profileId, secret })).hint;
}

export async function getCredentialHint(profileId: string): Promise<string | null> {
  return (await bridge().invoke('credentials:hint', { profileId })).hint;
}

export async function clearCredential(profileId: string): Promise<void> {
  await bridge().invoke('credentials:clear', { profileId });
}
