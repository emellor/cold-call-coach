import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGNED_OUT_EVENT } from '../lib/api.ts';
import { useAuth } from '../lib/auth.ts';
import { AuthGate } from './AuthGate.tsx';

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** The API's auth routes: the session, and a password that is "hunter22!". */
function mockAuth(session: { required: boolean; signedIn: boolean }) {
  const logins: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = urlOf(input);
    if (url === '/api/auth/session') return Promise.resolve(json(200, session));
    if (url === '/api/auth/logout') return Promise.resolve(json(204, null));
    if (url === '/api/auth/login') {
      const body = typeof init?.body === 'string' ? init.body : '{}';
      const { password } = JSON.parse(body) as { password: string };
      logins.push(password);
      return Promise.resolve(
        password === 'hunter22!'
          ? json(204, null)
          : json(401, { error: 'That password is wrong.' }),
      );
    }
    return Promise.resolve(json(404, { error: 'not found' }));
  });
  return { logins };
}

function Inside() {
  const { required, signOut } = useAuth();
  return (
    <div>
      <p>The app</p>
      {required && (
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      )}
    </div>
  );
}

const renderGate = () =>
  render(
    <AuthGate>
      <Inside />
    </AuthGate>,
  );

describe('AuthGate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the app straight away where no password is set', async () => {
    mockAuth({ required: false, signedIn: true });
    renderGate();
    expect(await screen.findByText('The app')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('asks for the password, says when it is wrong, and lets the rep in when it is right', async () => {
    const { logins } = mockAuth({ required: true, signedIn: false });
    renderGate();
    const password = await screen.findByLabelText('Password');
    fireEvent.change(password, { target: { value: 'guess' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That password is wrong.');

    fireEvent.change(password, { target: { value: 'hunter22!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('The app')).toBeInTheDocument();
    expect(logins).toEqual(['guess', 'hunter22!']);
  });

  it('goes back to sign-in when a session ends, or the rep signs out', async () => {
    mockAuth({ required: true, signedIn: true });
    renderGate();
    expect(await screen.findByText('The app')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    });
    expect(screen.getByLabelText('Password')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter22!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });

  it('shows the app when the API cannot say, leaving the API to refuse what it must', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    renderGate();
    expect(await screen.findByText('The app')).toBeInTheDocument();
  });
});
