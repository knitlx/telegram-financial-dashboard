'use client';

import { PieChart, Pie, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

interface ExpenseData {
  name: string;
  value: number;
}

interface ExpensePieChartProps {
  data: ExpenseData[];
  currency: string;
  totalExpenses: number;
}

const COLORS = ['#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ec4899', '#64748b'];

// Custom Tooltip Component
const CustomTooltip = ({ active, payload, currency, total }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0];
    // Manually calculate percentage
    const percentage = total > 0 ? ((data.value / total) * 100).toFixed(0) : 0;
    return (
      <div className="p-2 bg-white border border-gray-300 rounded-md shadow-lg text-gray-900">
        <p className="font-semibold">{`${data.name}`}</p>
        <p className="text-sm">{`Сумма: ${data.value.toFixed(2)} ${currency}`}</p>
        <p className="text-sm">{`Доля: ${percentage}%`}</p>
      </div>
    );
  }

  return null;
};


export default function ExpensePieChart({ data, currency, totalExpenses }: ExpensePieChartProps) {
  if (data.length === 0) {
    return <p className="text-center text-gray-500">Нет данных для расходов.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data as any[]}
          cx="50%"
          cy="50%"
          labelLine={false}
          outerRadius={70}
          fill="#8884d8"
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip currency={currency} total={totalExpenses} />} />
        <Legend verticalAlign="bottom" />
      </PieChart>
    </ResponsiveContainer>
  );
}
