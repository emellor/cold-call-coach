import { Route, Switch } from 'wouter';
import { DemoPage } from './demos/DemoPage.tsx';
import { DemosPage } from './demos/DemosPage.tsx';
import { CallPage } from './pages/CallPage.tsx';
import { CallsPage } from './pages/CallsPage.tsx';
import { ReviewPage } from './review/ReviewPage.tsx';

export function App() {
  return (
    <Switch>
      <Route path="/" component={CallPage} />
      <Route path="/calls" component={CallsPage} />
      <Route path="/calls/:id">{(params) => <ReviewPage key={params.id} id={params.id} />}</Route>
      <Route path="/demos" component={DemosPage} />
      <Route path="/demos/:id">{(params) => <DemoPage key={params.id} id={params.id} />}</Route>
      <Route>
        <main className="mx-auto max-w-2xl p-8">
          <h1 className="text-2xl font-semibold">Page not found</h1>
        </main>
      </Route>
    </Switch>
  );
}
