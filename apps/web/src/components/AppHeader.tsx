import { Link, useRoute } from 'wouter';
import { useAuth } from '../lib/auth.ts';
import { SystemStatus } from './SystemStatus.tsx';

function NavLink({ href, label }: { href: string; label: string }) {
  const [active] = useRoute(href === '/' ? href : `${href}/*?`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-md px-3 py-1.5 text-sm ${
        active ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </Link>
  );
}

/** The bar across every page: the name, where you can go, and whether the API is up. */
export function AppHeader() {
  const { required, signOut } = useAuth();
  return (
    // Wraps on a phone: the status drops below the name and the links rather than off the edge.
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-800 px-4 py-3 sm:px-6">
      <div className="flex items-center gap-4 sm:gap-6">
        <h1 className="text-lg font-semibold tracking-tight whitespace-nowrap">Cold Call Coach</h1>
        <nav aria-label="Main" className="flex gap-1">
          <NavLink href="/" label="Call" />
          <NavLink href="/calls" label="History" />
          <NavLink href="/demos" label="Demos" />
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <SystemStatus />
        {required && (
          <button
            type="button"
            onClick={signOut}
            className="rounded-md px-2 py-1 text-sm text-slate-400 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
