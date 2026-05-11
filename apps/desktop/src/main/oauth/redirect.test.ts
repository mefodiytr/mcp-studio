import { describe, expect, it } from 'vitest';

import { startLoopbackRedirect } from './redirect';

/** Subscribe to `waitForCallback()` immediately (so the rejection is never
 *  "unhandled" while the test sets up the triggering request), and surface the
 *  outcome — the captured callback, or the rejection error. */
function watch(redirect: { waitForCallback(): Promise<unknown> }): Promise<unknown> {
  return redirect.waitForCallback().then(
    (value) => value,
    (error: unknown) => error,
  );
}

describe('startLoopbackRedirect', () => {
  it('captures the code & state, then closes the listener', async () => {
    const redirect = await startLoopbackRedirect();
    expect(redirect.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const outcome = watch(redirect);
    const res = await fetch(`${redirect.redirectUri}?code=AUTH123&state=ST456`);
    expect(res.status).toBe(200);
    expect(await outcome).toEqual({ code: 'AUTH123', state: 'ST456' });
    await expect(fetch(redirect.redirectUri)).rejects.toThrow();
  });

  it('captures a code without a state', async () => {
    const redirect = await startLoopbackRedirect();
    const outcome = watch(redirect);
    await fetch(`${redirect.redirectUri}?code=ONLYCODE`);
    expect(await outcome).toEqual({ code: 'ONLYCODE', state: undefined });
  });

  it('rejects on an error callback (with the description)', async () => {
    const redirect = await startLoopbackRedirect();
    const outcome = watch(redirect);
    const res = await fetch(`${redirect.redirectUri}?error=access_denied&error_description=user%20said%20no`);
    expect(res.status).toBe(400);
    expect(await outcome).toBeInstanceOf(Error);
    expect((await outcome as Error).message).toMatch(/user said no/);
  });

  it('rejects a callback with neither code nor error', async () => {
    const redirect = await startLoopbackRedirect();
    const outcome = watch(redirect);
    await fetch(`${redirect.redirectUri}?foo=bar`);
    expect(await outcome).toBeInstanceOf(Error);
    expect((await outcome as Error).message).toMatch(/code|error/i);
  });

  it('rejects after the timeout', async () => {
    const redirect = await startLoopbackRedirect({ timeoutMs: 50 });
    const outcome = watch(redirect);
    expect(await outcome).toBeInstanceOf(Error);
    expect((await outcome as Error).message).toMatch(/timed out/i);
  });

  it('rejects waitForCallback when close() is called first', async () => {
    const redirect = await startLoopbackRedirect();
    const outcome = watch(redirect);
    redirect.close();
    expect(await outcome).toBeInstanceOf(Error);
    expect((await outcome as Error).message).toMatch(/closed/i);
  });

  it('serves 404 for other paths', async () => {
    const redirect = await startLoopbackRedirect();
    const outcome = watch(redirect);
    const res = await fetch(`http://127.0.0.1:${new URL(redirect.redirectUri).port}/elsewhere`);
    expect(res.status).toBe(404);
    redirect.close();
    expect(await outcome).toBeInstanceOf(Error);
  });
});
