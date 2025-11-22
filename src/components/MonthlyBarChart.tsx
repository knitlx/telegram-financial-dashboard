'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface MonthlyData {
  name: string;
  income: number;
  expenses: number;
}

interface MonthlyBarChartProps {
  data: MonthlyData[];
  currency: string;
}

// Custom Tooltip for Bar Chart
const CustomTooltip = ({ active, payload, label, currency }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="p-2 bg-white border border-gray-300 rounded-md shadow-lg text-gray-900">
        <p className="font-semibold">{label}</p>
        {payload.map((pld: any, index: number) => (
          <div key={index} style={{ color: pld.color }}>
            {`${pld.name}: ${pld.value.toFixed(2)} ${currency}`}
          </div>
        ))}
      </div>
    );
  }
  return null;
};


export default function MonthlyBarChart({ data, currency }: MonthlyBarChartProps) {
  if (data.length === 0) {
    return <p className="text-center text-gray-500">Нет данных для доходов и расходов по месяцам.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip content={<CustomTooltip currency={currency} />} />
        <Legend />
        <Bar dataKey="income" fill="#10b981" name="Доходы" />
        <Bar dataKey="expenses" fill="#f97316" name="Расходы" />
      </BarChart>
    </ResponsiveContainer>
  );
}

