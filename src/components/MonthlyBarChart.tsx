'use client';

import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface Transaction {
  id: string;
  amount: number | string;
  currency: string;
  kind: string;
  timestamp: string;
}

interface MonthlyBarChartProps {
  transactions: Transaction[];
  currency: string;
}

const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

interface TooltipPayloadItem {
  name: string;
  value: number;
  fill: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  currency: string;
}

const CustomTooltip = ({ active, payload, label, currency }: CustomTooltipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2.5 bg-white rounded-xl shadow-lg text-xs border border-slate-100 min-w-[130px]">
      <p className="font-semibold text-slate-600 mb-2">{label}</p>
      {payload.map((p, i: number) => (
        <div key={i} className="flex items-center justify-between gap-3 mb-1 last:mb-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.fill }} />
            <span className="text-slate-500">{p.name}</span>
          </div>
          <span className="font-bold text-slate-800">{p.value.toFixed(0)} {currency}</span>
        </div>
      ))}
    </div>
  );
};

export default function MonthlyBarChart({ transactions, currency }: MonthlyBarChartProps) {
  const [drillMonth, setDrillMonth] = useState<string | null>(null);
  const toNumber = (value: number | string): number => {
    if (typeof value === 'number') return value;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const monthData = useMemo(() => {
    const buckets: Record<string, { income: number; expenses: number; label: string }> = {};
    transactions.forEach(tx => {
      const a = toNumber(tx.amount);
      if (isNaN(a) || tx.kind === 'transfer') return;
      const d = new Date(tx.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
      if (!buckets[key]) buckets[key] = { income: 0, expenses: 0, label };
      if (tx.kind === 'income') buckets[key].income += a;
      else buckets[key].expenses += a;
    });
    return Object.entries(buckets).sort(([a],[b]) => a.localeCompare(b)).map(([name, d]) => ({ name, ...d }));
  }, [transactions]);

  const weekData = useMemo(() => {
    if (!drillMonth) return [];
    const buckets: Record<string, { income: number; expenses: number; label: string }> = {};
    transactions.forEach(tx => {
      const a = toNumber(tx.amount);
      if (isNaN(a) || tx.kind === 'transfer') return;
      const d = new Date(tx.timestamp);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (monthKey !== drillMonth) return;
      const ws = new Date(d);
      ws.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key = fmt(ws);
      const we = new Date(ws); we.setDate(ws.getDate() + 6);
      const label = `${ws.getDate()} – ${we.getDate()} ${ws.toLocaleDateString('ru-RU', { month: 'short' })}`;
      if (!buckets[key]) buckets[key] = { income: 0, expenses: 0, label };
      if (tx.kind === 'income') buckets[key].income += a;
      else buckets[key].expenses += a;
    });
    return Object.entries(buckets).sort(([a],[b]) => a.localeCompare(b)).map(([name, d]) => ({ name, ...d }));
  }, [transactions, drillMonth]);

  const chartData = drillMonth ? weekData : monthData;
  const drillLabel = drillMonth
    ? new Date(drillMonth + '-01').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    : null;

  if (monthData.length === 0) {
    return <p className="text-center text-gray-500 text-sm">Нет данных.</p>;
  }

  const handleClick = (barData: { name?: string }) => {
    const key = barData?.name;
    if (!key) return;
    if (!drillMonth) {
      setDrillMonth(key);
    }
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 mb-3 text-xs">
        {drillMonth ? (
          <button
            onClick={() => setDrillMonth(null)}
            className="font-medium text-indigo-500 hover:text-indigo-700 underline cursor-pointer"
          >
            ← По месяцам
          </button>
        ) : (
          <span className="font-medium text-slate-500">По месяцам — нажми на столбик</span>
        )}
        {drillMonth && (
          <>
            <span className="text-slate-300">›</span>
            <span className="font-semibold text-slate-700">{drillLabel}</span>
          </>
        )}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ fill: '#f8fafc' }} />
          <Bar dataKey="income" name="Доходы" radius={[4,4,0,0]} cursor={drillMonth ? 'default' : 'pointer'} onClick={handleClick}>
            {chartData.map((e) => <Cell key={e.name} fill="#2dd4bf" />)}
          </Bar>
          <Bar dataKey="expenses" name="Расходы" radius={[4,4,0,0]} cursor={drillMonth ? 'default' : 'pointer'} onClick={handleClick}>
            {chartData.map((e) => <Cell key={e.name} fill="#fb7185" />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="flex gap-4 justify-center mt-2">
        <span className="flex items-center gap-1 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full inline-block" style={{backgroundColor:'#2dd4bf'}}/>Доходы
        </span>
        <span className="flex items-center gap-1 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full inline-block" style={{backgroundColor:'#fb7185'}}/>Расходы
        </span>
      </div>
    </div>
  );
}
