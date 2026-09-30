import type { CostBreakdown, CostKey } from '@ccc/contracts';
import { COST_LABELS, costDetail, money } from './format.ts';

/**
 * What the call cost, line by line, with a warning over the price table's line.
 * `labels` renames lines for a call that isn't the rep's own, such as a reverse
 * call's notes, priced where a review would be.
 */
export function CostSection({
  cost,
  labels = {},
}: {
  cost: CostBreakdown;
  labels?: Partial<Record<CostKey, string>>;
}) {
  const total = `${money(cost.totalUsd)}${cost.incomplete ? '+' : ''}`;
  return (
    <section
      aria-labelledby="cost-heading"
      className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
    >
      <h3
        id="cost-heading"
        className="mb-3 flex items-baseline justify-between text-sm font-medium tracking-wide text-slate-300 uppercase"
      >
        Cost
        <span
          className={`text-base tracking-normal normal-case tabular-nums ${cost.overBudget ? 'text-amber-300' : 'text-slate-100'}`}
        >
          {total}
        </span>
      </h3>
      {cost.overBudget && (
        <p role="alert" className="mb-3 text-sm text-amber-300">
          This call cost {total}, over the {money(cost.warnAboveUsd)} warning line.
        </p>
      )}
      <table className="w-full text-sm">
        <tbody>
          {cost.lines.map((line) => (
            <tr key={line.key} className="border-t border-slate-800 first:border-t-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-slate-300">
                {labels[line.key] ?? COST_LABELS[line.key]}
              </th>
              <td className="py-1.5 pr-3 text-xs text-slate-500">{costDetail(line)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {line.usd === null ? 'not priced' : money(line.usd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cost.incomplete && (
        <p className="mt-2 text-xs text-slate-500">
          Some lines have no price: add their model to config/prices.json.
        </p>
      )}
    </section>
  );
}
