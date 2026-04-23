'use client';

import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface ExpenseData {
  name: string;
  value: number;
  [key: string]: string | number;
}

interface Transaction {
  id: string;
  title: string;
  amount: number | string;
  currency: string;
  category: string;
  kind: string;
  timestamp: string;
}

interface ExpensePieChartProps {
  data: ExpenseData[];
  currency: string;
  totalExpenses: number;
  transactions?: Transaction[];
}

const COLORS = ['#fb7185', '#2dd4bf', '#818cf8', '#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#f472b6'];

export default function ExpensePieChart({ data, currency, totalExpenses, transactions = [] }: ExpensePieChartProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const toNumber = (value: number | string): number => {
    if (typeof value === 'number') return value;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  if (data.length === 0) {
    return <p className="text-center text-gray-500 text-sm">Нет данных для расходов.</p>;
  }

  const categoryTxs = activeCategory
    ? transactions
        .filter(tx => tx.category === activeCategory && tx.kind === 'expense')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    : [];

  const activeData = data.find(d => d.name === activeCategory);
  const activePct = activeData && totalExpenses > 0 ? ((activeData.value / totalExpenses) * 100).toFixed(0) : '0';

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            outerRadius={80}
            innerRadius={40}
            dataKey="value"
            onClick={(entry) => {
              const name = (entry as { name?: string })?.name;
              if (!name) return;
              setActiveCategory((prev) => (prev === name ? null : name));
            }}
            cursor="pointer"
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={COLORS[index % COLORS.length]}
                opacity={activeCategory && activeCategory !== entry.name ? 0.3 : 1}
                stroke={activeCategory === entry.name ? '#1e293b' : 'none'}
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => [`${value.toFixed(0)} ${currency}`, '']}
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Легенда */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 mb-3">
        {data.map((entry, index) => (
          <button
            key={entry.name}
            onClick={() => setActiveCategory(prev => prev === entry.name ? null : entry.name)}
            className="flex items-center gap-1.5 text-xs cursor-pointer rounded-full px-2 py-0.5 transition-colors hover:bg-slate-100 active:bg-slate-200"
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: COLORS[index % COLORS.length], opacity: activeCategory && activeCategory !== entry.name ? 0.3 : 1 }}
            />
            <span className={activeCategory === entry.name ? 'font-semibold text-slate-800' : 'text-slate-500'}>
              {entry.name}
            </span>
          </button>
        ))}
      </div>

      {/* Транзакции выбранной категории */}
      {activeCategory && (
        <div className="mt-2 border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700">{activeCategory}</span>
            <div className="text-right">
              <span className="text-sm font-bold text-rose-400">{activeData?.value.toFixed(0)} {currency}</span>
              <span className="text-xs text-slate-400 ml-1">({activePct}%)</span>
            </div>
          </div>
          {categoryTxs.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">Нет транзакций</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {categoryTxs.map(tx => (
                <div key={tx.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
                  <div>
                    <div className="text-xs font-medium text-slate-700">{tx.title}</div>
                    <div className="text-xs text-slate-400">
                      {new Date(tx.timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-rose-400">
                    −{toNumber(tx.amount).toFixed(0)} {tx.currency}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
