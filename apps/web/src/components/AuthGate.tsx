import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { SIGNED_OUT_EVENT, fetchSession, signIn, signOut } from '../lib/api.ts';
import { AuthContext } from '../lib/auth.ts';

type Gate = { kind: 'checking' } | { kind: 'in'; required: boolean } | { kind: 'out' };

/**
 * Shows the app once signed in. A deploy with APP_PASSWORD asks for it first;
 * locally there is nothing to ask. Any 401 later (an expired session) brings
 * the sign-in screen back. The API enforces all this; the gate only asks.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' });

  useEffect(() => {
    const abort = new AbortController();
    fetchSession(abort.signal)
      .then(({ required, signedIn }) =>
        setGate(signedIn ? { kind: 'in', required } : { kind: 'out' }),
      )
      // The API may be down: show the app, whose own requests will say so.
      .catch(() => {
        if (!abort.signal.aborted) setGate({ kind: 'in', required: false });
      });
    const onSignedOut = () => setGate({ kind: 'out' });
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => {
      abort.abort();
      window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
    };
  }, []);

  const leave = useCallback(() => {
    void signOut().finally(() => setGate({ kind: 'out' }));
  }, []);
  const auth = useMemo(
    () => ({ required: gate.kind === 'in' && gate.required, signOut: leave }),
    [gate, leave],
  );

  if (gate.kind === 'checking') return null;
  if (gate.kind === 'out')
    return <SignIn onSignedIn={() => setGate({ kind: 'in', required: true })} />;
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(password);
      onSignedIn();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form
        onSubmit={(event) => void submit(event)}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
      >
        <h1 className="text-xl font-semibold">Cold Call Coach</h1>
        <label className="flex flex-col gap-1.5 text-sm text-slate-300">
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-400"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="rounded-full bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
