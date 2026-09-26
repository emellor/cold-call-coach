import { Route, Switch } from 'wouter';
import { HomePage } from './pages/HomePage.tsx';

export function App() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route>
        <main className="mx-auto max-w-2xl p-8">
          <h1 className="text-2xl font-semibold">Page not found</h1>
        </main>
      </Route>
    </Switch>
  );
}
