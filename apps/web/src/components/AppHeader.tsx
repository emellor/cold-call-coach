import { Link, useRoute } from 'wouter';
import { SystemStatus } from './SystemStatus.tsx';

function NavLink({ href, label }: { href: string; label: string }) {
  const [active] = useRoute(href === '/calls' ? '/calls/*?' : href);
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
  return (
    <header className="flex items-center justify-between gap-4 border-b border-slate-800 px-6 py-3">
      <div className="flex items-center gap-6">
        <h1 className="text-lg font-semibold tracking-tight">Cold Call Coach</h1>
        <nav aria-label="Main" className="flex gap-1">
          <NavLink href="/" label="Call" />
          <NavLink href="/calls" label="History" />
        </nav>
      </div>
      <SystemStatus />
    </header>
  );
}
