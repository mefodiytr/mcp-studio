import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { setCredential, useCreateProfile, useUpdateProfile } from '@renderer/lib/profiles';
import { cn } from '@renderer/lib/utils';
import type { Profile, ProfileInput } from '@shared/domain/profile';

type TransportKind = 'http' | 'stdio';
// 'oauth' is accepted (so editing an OAuth profile works) but the radio for it
// is added in C29 along with the scope / pre-registered-client-id fields.
type AuthMethod = 'none' | 'bearer' | 'header' | 'oauth';

interface FormState {
  name: string;
  transport: TransportKind;
  url: string;
  command: string;
  argsText: string;
  cwd: string;
  authMethod: AuthMethod;
  headerName: string;
  secret: string;
  oauthScope: string;
  oauthClientId: string;
  tagEnv: string;
  tagProject: string;
  tlsInsecure: boolean;
  tlsReason: string;
}

function initialState(editing?: Profile): FormState {
  return {
    name: editing?.name ?? '',
    transport: editing?.transport ?? 'http',
    url: editing?.transport === 'http' ? editing.url : '',
    command: editing?.transport === 'stdio' ? editing.command : '',
    argsText: editing?.transport === 'stdio' ? editing.args.join(' ') : '',
    cwd: editing?.transport === 'stdio' ? (editing.cwd ?? '') : '',
    authMethod: editing?.auth.method ?? 'none',
    headerName: editing?.auth.method === 'header' ? editing.auth.headerName : '',
    secret: '',
    oauthScope: editing?.auth.method === 'oauth' ? (editing.auth.scope ?? '') : '',
    oauthClientId: editing?.auth.method === 'oauth' ? (editing.auth.clientId ?? '') : '',
    tagEnv: editing?.tags?.env ?? '',
    tagProject: editing?.tags?.project ?? '',
    tlsInsecure: editing?.tlsInsecure ?? false,
    tlsReason: editing?.tlsInsecureReason ?? '',
  };
}

function authConfigOf(s: FormState): ProfileInput['auth'] {
  if (s.authMethod === 'header') return { method: 'header', headerName: s.headerName.trim() };
  if (s.authMethod === 'oauth') {
    return {
      method: 'oauth',
      ...(s.oauthScope.trim() ? { scope: s.oauthScope.trim() } : {}),
      ...(s.oauthClientId.trim() ? { clientId: s.oauthClientId.trim() } : {}),
    };
  }
  return { method: s.authMethod };
}

function buildInput(s: FormState): ProfileInput {
  const auth = authConfigOf(s);
  const tags =
    s.tagEnv.trim() || s.tagProject.trim()
      ? {
          ...(s.tagEnv.trim() ? { env: s.tagEnv.trim() } : {}),
          ...(s.tagProject.trim() ? { project: s.tagProject.trim() } : {}),
        }
      : undefined;
  const common = { name: s.name.trim(), auth, ...(tags ? { tags } : {}) };
  if (s.transport === 'http') {
    return {
      transport: 'http',
      url: s.url.trim(),
      ...common,
      ...(s.tlsInsecure
        ? { tlsInsecure: true, ...(s.tlsReason.trim() ? { tlsInsecureReason: s.tlsReason.trim() } : {}) }
        : {}),
    };
  }
  return {
    transport: 'stdio',
    command: s.command.trim(),
    args: s.argsText.trim() ? s.argsText.trim().split(/\s+/) : [],
    ...(s.cwd.trim() ? { cwd: s.cwd.trim() } : {}),
    ...common,
  };
}

function validate(s: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!s.name.trim()) errors['name'] = 'Required';
  if (s.transport === 'http') {
    if (!s.url.trim()) errors['url'] = 'Required';
    else
      try {
        new URL(s.url.trim());
      } catch {
        errors['url'] = 'Not a valid URL';
      }
  } else if (!s.command.trim()) {
    errors['command'] = 'Required';
  }
  if (s.authMethod === 'header' && !s.headerName.trim()) errors['headerName'] = 'Required';
  return errors;
}

const labelClass = 'text-sm font-medium';
const fieldClass = 'flex flex-col gap-1.5';
const errorClass = 'text-xs text-destructive';

export function ProfileWizard({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Profile;
}) {
  const { t } = useTranslation();
  const createProfile = useCreateProfile();
  const updateProfile = useUpdateProfile();
  const [state, setState] = useState<FormState>(() => initialState(editing));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setState(initialState(editing));
      setFieldErrors({});
      setError(null);
    }
  }, [open, editing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setState((prev) => ({ ...prev, [key]: value }) as FormState);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const errors = validate(state);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const input = buildInput(state);
      const profile = editing
        ? await updateProfile.mutateAsync({ id: editing.id, input })
        : await createProfile.mutateAsync(input);
      if ((state.authMethod === 'bearer' || state.authMethod === 'header') && state.secret.trim()) {
        await setCredential(profile.id, state.secret.trim());
      }
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t('wizard.editTitle') : t('wizard.addTitle')}</DialogTitle>
          <DialogDescription>{t('wizard.description')}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
          <div className={fieldClass}>
            <label className={labelClass} htmlFor="wiz-name">
              {t('wizard.name')}
            </label>
            <Input id="wiz-name" value={state.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!fieldErrors['name']} />
            {fieldErrors['name'] && <span className={errorClass}>{fieldErrors['name']}</span>}
          </div>

          <div className={fieldClass}>
            <span className={labelClass}>{t('wizard.transport')}</span>
            <div className="flex gap-4 text-sm">
              {(['http', 'stdio'] as const).map((kind) => (
                <label key={kind} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="wiz-transport"
                    checked={state.transport === kind}
                    onChange={() => set('transport', kind)}
                  />
                  {kind}
                </label>
              ))}
            </div>
          </div>

          {state.transport === 'http' ? (
            <div className={fieldClass}>
              <label className={labelClass} htmlFor="wiz-url">
                {t('wizard.url')}
              </label>
              <Input
                id="wiz-url"
                placeholder="https://host:port/mcp"
                value={state.url}
                onChange={(e) => set('url', e.target.value)}
                aria-invalid={!!fieldErrors['url']}
              />
              {fieldErrors['url'] && <span className={errorClass}>{fieldErrors['url']}</span>}
            </div>
          ) : (
            <>
              <div className={fieldClass}>
                <label className={labelClass} htmlFor="wiz-command">
                  {t('wizard.command')}
                </label>
                <Input
                  id="wiz-command"
                  placeholder="npx"
                  value={state.command}
                  onChange={(e) => set('command', e.target.value)}
                  aria-invalid={!!fieldErrors['command']}
                />
                {fieldErrors['command'] && <span className={errorClass}>{fieldErrors['command']}</span>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className={fieldClass}>
                  <label className={labelClass} htmlFor="wiz-args">
                    {t('wizard.args')}
                  </label>
                  <Input
                    id="wiz-args"
                    placeholder="-y @scope/server"
                    value={state.argsText}
                    onChange={(e) => set('argsText', e.target.value)}
                  />
                </div>
                <div className={fieldClass}>
                  <label className={labelClass} htmlFor="wiz-cwd">
                    {t('wizard.cwd')}
                  </label>
                  <Input id="wiz-cwd" value={state.cwd} onChange={(e) => set('cwd', e.target.value)} />
                </div>
              </div>
            </>
          )}

          <div className={fieldClass}>
            <span className={labelClass}>{t('wizard.auth')}</span>
            <div className="flex gap-4 text-sm">
              {(['none', 'bearer', 'header', 'oauth'] as const).map((method) => (
                <label key={method} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="wiz-auth"
                    checked={state.authMethod === method}
                    onChange={() => set('authMethod', method)}
                  />
                  {method}
                </label>
              ))}
            </div>
          </div>

          {state.authMethod === 'oauth' && (
            <>
              <div className={fieldClass}>
                <label className={labelClass} htmlFor="wiz-oauth-scope">
                  {t('wizard.oauthScope')}
                </label>
                <Input
                  id="wiz-oauth-scope"
                  placeholder="mcp"
                  value={state.oauthScope}
                  onChange={(e) => set('oauthScope', e.target.value)}
                />
              </div>
              <div className={fieldClass}>
                <label className={labelClass} htmlFor="wiz-oauth-client-id">
                  {t('wizard.oauthClientId')}
                </label>
                <Input
                  id="wiz-oauth-client-id"
                  value={state.oauthClientId}
                  onChange={(e) => set('oauthClientId', e.target.value)}
                />
                <span className="text-xs text-muted-foreground">{t('wizard.oauthClientIdHint')}</span>
              </div>
            </>
          )}

          {state.authMethod === 'header' && (
            <div className={fieldClass}>
              <label className={labelClass} htmlFor="wiz-header-name">
                {t('wizard.headerName')}
              </label>
              <Input
                id="wiz-header-name"
                placeholder="X-Api-Key"
                value={state.headerName}
                onChange={(e) => set('headerName', e.target.value)}
                aria-invalid={!!fieldErrors['headerName']}
              />
              {fieldErrors['headerName'] && <span className={errorClass}>{fieldErrors['headerName']}</span>}
            </div>
          )}

          {(state.authMethod === 'bearer' || state.authMethod === 'header') && (
            <div className={fieldClass}>
              <label className={labelClass} htmlFor="wiz-secret">
                {t('wizard.secret')}
              </label>
              <Input
                id="wiz-secret"
                type="password"
                placeholder={editing ? t('wizard.secretKeep') : ''}
                value={state.secret}
                onChange={(e) => set('secret', e.target.value)}
              />
              <span className="text-xs text-muted-foreground">{t('wizard.secretNote')}</span>
            </div>
          )}

          {state.transport === 'http' && (
            <div className={fieldClass}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={state.tlsInsecure} onChange={(e) => set('tlsInsecure', e.target.checked)} />
                {t('wizard.tlsInsecure')}
              </label>
              {state.tlsInsecure && (
                <Input
                  placeholder={t('wizard.tlsReason')}
                  value={state.tlsReason}
                  onChange={(e) => set('tlsReason', e.target.value)}
                />
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className={fieldClass}>
              <label className={labelClass} htmlFor="wiz-env">
                {t('wizard.tagEnv')}
              </label>
              <Input id="wiz-env" placeholder="dev / staging / prod" value={state.tagEnv} onChange={(e) => set('tagEnv', e.target.value)} />
            </div>
            <div className={fieldClass}>
              <label className={labelClass} htmlFor="wiz-project">
                {t('wizard.tagProject')}
              </label>
              <Input id="wiz-project" value={state.tagProject} onChange={(e) => set('tagProject', e.target.value)} />
            </div>
          </div>

          {error && (
            <div className={cn('rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive')}>
              {error}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t('wizard.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {editing ? t('wizard.save') : t('wizard.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
