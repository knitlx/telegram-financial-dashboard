'use client';

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import chart components with SSR disabled
const ExpensePieChart = dynamic(() => import('@/components/ExpensePieChart'), { ssr: false });
const MonthlyBarChart = dynamic(() => import('@/components/MonthlyBarChart'), { ssr: false });


// --- Helper Components & Icons ---
const IncomeIcon = () => (
  <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
  </svg>
);

const ExpenseIcon = () => (
  <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
  </svg>
);


// Declare the Telegram WebApp type on the window object
declare global {
  interface Window {
    Telegram: any;
  }
}

interface Transaction {
  id: string;
  user_id: string;
  category: string;
  title: string;
  amount: number;
  currency: string;
  timestamp: string; // ISO date string
  day: string;       // YYYY-MM-DD
  kind: 'income' | 'expense';
  created_at: string;
  updated_at: string;
}

const ITEMS_PER_PAGE = 10;

export default function Home() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // --- Filter & Sort State ---
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState('month'); // 'month', 'quarter', 'year', 'all'
  const [typeFilter, setTypeFilter] = useState('all'); // 'all', 'income', 'expense'
  const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);


  // --- Haptic Feedback Handler ---
  const handleFilterClick = (setter: Function, value: any) => {
    try {
      if (window.Telegram?.WebApp?.HapticFeedback?.impactOccurred) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
      }
    } catch (e) {
      // Haptic feedback is not critical, so we can ignore errors
    }
    setter(value);
  };


  useEffect(() => {
    // Basic Telegram Mini App setup
    if (typeof window.Telegram !== 'undefined' && window.Telegram.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
    }

    const initData = typeof window.Telegram !== 'undefined' ? window.Telegram.WebApp.initData : null;

    if (!initData) {
      setError("Это приложение предназначено для работы внутри Telegram.");
      setLoading(false);
      return;
    }

    async function fetchTransactions() {
      try {
        const response = await fetch('/api/transactions', { headers: { 'Authorization': `Tma ${initData}` } });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        const data: Transaction[] = await response.json();
        setTransactions(data);
        if (data.length > 0) {
          const currencies = [...new Set(data.map(tx => tx.currency))];
          if (currencies.length === 1) {
            setSelectedCurrency(currencies[0]); // Only one currency, select it
          } else {
            // Multiple currencies, find the most frequent one
            const currencyCounts: { [key: string]: number } = {};
            data.forEach(tx => {
              currencyCounts[tx.currency] = (currencyCounts[tx.currency] || 0) + 1;
            });

            let mostFrequentCurrency = '';
            let maxCount = 0;
            for (const currency in currencyCounts) {
              if (currencyCounts[currency] > maxCount) {
                maxCount = currencyCounts[currency];
                mostFrequentCurrency = currency;
              }
            }
            setSelectedCurrency(mostFrequentCurrency || currencies[0]); // Fallback to first if somehow no frequent
          }
        } else {
          setSelectedCurrency('all'); // If no data, default to 'all'
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    fetchTransactions();
  }, []);

  // --- Data Processing Pipeline ---

  // 1. Base filter for the transaction list (time, then currency if not 'all')
  const baseFilteredTransactions = useMemo(() => {
    const now = new Date();
    let startDate = new Date();
    let timeFiltered = transactions;

    if (timeRange !== 'all') {
      switch (timeRange) {
        case 'month': startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
        case 'quarter':
          const quarter = Math.floor(now.getMonth() / 3);
          startDate = new Date(now.getFullYear(), quarter * 3, 1);
          break;
        case 'year': startDate = new Date(now.getFullYear(), 0, 1); break;
      }
      timeFiltered = transactions.filter(tx => new Date(tx.timestamp) >= startDate);
    }
    
    if (selectedCurrency === 'all') {
      return timeFiltered;
    }
    return timeFiltered.filter(tx => tx.currency === selectedCurrency);
  }, [transactions, selectedCurrency, timeRange]);
  
  // 2. Data source for stats and charts (requires a single currency)
  const statsAndChartsData = useMemo(() => {
    if (selectedCurrency === 'all') return [];
    return baseFilteredTransactions;
  }, [baseFilteredTransactions, selectedCurrency]);

  // 3. Further filter and sort the list for display
  const processedTransactions = useMemo(() => {
    let list = [...baseFilteredTransactions];

    if (typeFilter !== 'all') {
      list = list.filter(tx => tx.kind === typeFilter);
    }

    list.sort((a, b) => {
      let valA = a[sortConfig.key as keyof Transaction];
      let valB = b[sortConfig.key as keyof Transaction];

      if (sortConfig.key === 'amount') {
        valA = parseFloat(valA as any);
        valB = parseFloat(valB as any);
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    
    return list;
  }, [baseFilteredTransactions, typeFilter, sortConfig]);

  // 4. Paginate the final list
  const paginatedTransactions = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return processedTransactions.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [processedTransactions, currentPage]);

  const totalPages = Math.ceil(processedTransactions.length / ITEMS_PER_PAGE);

  useEffect(() => { setCurrentPage(1); }, [selectedCurrency, timeRange, typeFilter, sortConfig]);


  // --- Stat & Chart Calculations (use statsAndChartsData) ---

  const availableCurrencies = useMemo(() => [...new Set(transactions.map(tx => tx.currency))], [transactions]);

  const { totalIncome, totalExpenses, balance } = useMemo(() => {
    let income = 0, expenses = 0;
    statsAndChartsData.forEach(tx => {
      const amount = parseFloat(tx.amount as any);
      if (isNaN(amount)) return;
      if (tx.kind === 'income') income += amount;
      else if (tx.kind === 'expense') expenses += amount;
    });
    return { totalIncome: income, totalExpenses: expenses, balance: income - expenses };
  }, [statsAndChartsData]);

  const expenseCategoriesData = useMemo(() => {
    const categories: { [key: string]: number } = {};
    statsAndChartsData.forEach(tx => {
      const amount = parseFloat(tx.amount as any);
      if (isNaN(amount) || tx.kind !== 'expense') return;
      categories[tx.category] = (categories[tx.category] || 0) + amount;
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [statsAndChartsData]);

  const monthlySummaryData = useMemo(() => {
    const months: { [key: string]: { income: number; expenses: number } } = {};
    statsAndChartsData.forEach(tx => {
      const amount = parseFloat(tx.amount as any);
      if (isNaN(amount)) return;
      const txDate = new Date(tx.timestamp);
      const monthYear = `${txDate.getFullYear()}-${(txDate.getMonth() + 1).toString().padStart(2, '0')}`;
      if (!months[monthYear]) months[monthYear] = { income: 0, expenses: 0 };
      if (tx.kind === 'income') months[monthYear].income += amount;
      else if (tx.kind === 'expense') months[monthYear].expenses += amount;
    });
    return Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).map(([monthYear, data]) => ({ name: monthYear, ...data }));
  }, [statsAndChartsData]);


  // --- Render Logic ---

  if (loading) return <div className="p-8 text-center text-gray-500">Загрузка данных...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Ошибка: {error}</div>;

  const FilterButton = ({ filterValue, label }: { filterValue: string, label: string }) => (
    <button onClick={() => handleFilterClick(setTypeFilter, filterValue)} className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors duration-200 ${typeFilter === filterValue ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
      {label}
    </button>
  );

  return (
    <main className="min-h-screen bg-slate-50 p-4 font-sans">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-center text-slate-800">Финансовая сводка</h1>

        {/* Filters Card */}
        <div className="bg-white p-4 rounded-xl shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-500 mb-2 px-2">Период</h3>
            <div className="flex justify-center gap-2 flex-wrap">
              <button onClick={() => handleFilterClick(setTimeRange, 'month')} className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors duration-200 ${timeRange === 'month' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>Месяц</button>
              <button onClick={() => handleFilterClick(setTimeRange, 'quarter')} className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors duration-200 ${timeRange === 'quarter' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>Квартал</button>
              <button onClick={() => handleFilterClick(setTimeRange, 'year')} className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors duration-200 ${timeRange === 'year' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>Год</button>
              <button onClick={() => handleFilterClick(setTimeRange, 'all')} className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors duration-200 ${timeRange === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>Всё время</button>
            </div>
          </div>
          {availableCurrencies.length > 1 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-500 mb-2 px-2">Валюта</h3>
              <div className="flex justify-center gap-2 flex-wrap">
                <button onClick={() => handleFilterClick(setSelectedCurrency, 'all')} className={`px-4 py-1.5 rounded-full text-sm font-bold transition-colors duration-200 ${selectedCurrency === 'all' ? 'bg-slate-800 text-white shadow-sm' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}>Все</button>
                {availableCurrencies.map(currency => (
                  <button
                    key={currency}
                    onClick={() => handleFilterClick(setSelectedCurrency, currency)}
                    className={`px-4 py-1.5 rounded-full text-sm font-bold transition-colors duration-200 ${selectedCurrency === currency ? 'bg-slate-800 text-white shadow-sm' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                  >
                    {currency}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {selectedCurrency !== 'all' ? (
          <>
            {/* Summary Statistics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div className="bg-white shadow-sm rounded-xl p-5"><div className="text-md text-slate-500">Доходы</div><div className="text-2xl font-bold text-green-600 mt-1">{totalIncome.toFixed(2)} {selectedCurrency}</div></div>
              <div className="bg-white shadow-sm rounded-xl p-5"><div className="text-md text-slate-500">Расходы</div><div className="text-2xl font-bold text-slate-700 mt-1">{totalExpenses.toFixed(2)} {selectedCurrency}</div></div>
              <div className="bg-white shadow-sm rounded-xl p-5"><div className="text-md text-slate-500">Итог</div><div className={`text-2xl font-bold mt-1 ${balance > 0 ? 'text-green-600' : balance < 0 ? 'text-slate-700' : 'text-slate-800'}`}>{(typeof balance === 'number' && !isNaN(balance)) ? balance.toFixed(2) : '0.00'} {selectedCurrency}</div></div>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white shadow-sm rounded-xl p-4"><h2 className="text-lg font-semibold mb-4 text-center text-slate-800">Расходы по категориям</h2><ExpensePieChart data={expenseCategoriesData} currency={selectedCurrency || ''} totalExpenses={totalExpenses} /></div>
              <div className="bg-white shadow-sm rounded-xl p-4"><h2 className="text-lg font-semibold mb-4 text-center text-slate-800">Динамика по месяцам</h2><MonthlyBarChart data={monthlySummaryData} currency={selectedCurrency || ''} /></div>
            </div>
          </>
        ) : (
          <div className="bg-white shadow-sm rounded-xl p-6 text-center text-slate-600">
            <p>Выберите валюту для просмотра статистики и диаграмм.</p>
          </div>
        )}

        {/* Transaction List */}
        <div className="bg-white shadow-sm rounded-xl p-4">
          <div className="flex flex-col sm:flex-row justify-between items-center mb-3 px-2 gap-4">
            <h2 className="text-lg font-semibold text-slate-800">Транзакции</h2>
            <div className="flex items-center gap-4 flex-wrap justify-end">
              <div className="flex items-center gap-2">
                <FilterButton filterValue="all" label="Все" />
                <FilterButton filterValue="income" label="Доходы" />
                <FilterButton filterValue="expense" label="Расходы" />
              </div>
              <select onChange={(e) => { const [key, direction] = e.target.value.split('-'); handleFilterClick(setSortConfig, { key, direction }); }} value={`${sortConfig.key}-${sortConfig.direction}`} className="text-sm bg-gray-100 border-gray-300 rounded-md p-1.5 text-gray-800">
                <option value="timestamp-desc">Сначала новые</option>
                <option value="timestamp-asc">Сначала старые</option>
                <option value="amount-desc">Сумма (убыв.)</option>
                <option value="amount-asc">Сумма (возр.)</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            {paginatedTransactions.length === 0 ? (
              <p className="text-center text-slate-500 py-8">Транзакций не найдено.</p>
            ) : (
              paginatedTransactions.map((tx, index) => (
                <div key={tx.id} className={`flex items-center p-3 ${index < paginatedTransactions.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <div className="mr-4">{tx.kind === 'income' ? <IncomeIcon /> : <ExpenseIcon />}</div>
                  <div className="flex-grow"><div className="font-medium text-slate-800">{tx.title}</div><div className="text-sm text-slate-500">{tx.category} &middot; {new Date(tx.timestamp).toLocaleDateString()}</div></div>
                  <div className={`text-right font-semibold ${tx.kind === 'income' ? 'text-green-600' : 'text-slate-700'}`}>{tx.kind === 'expense' ? '-' : '+'}{parseFloat(tx.amount as any).toFixed(2)} {tx.currency}</div>
                </div>
              ))
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-200">
              <button onClick={() => { handleFilterClick(setCurrentPage, (p: number) => Math.max(1, p - 1)); }} disabled={currentPage === 1} className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md disabled:opacity-50">Назад</button>
              <span className="text-sm text-slate-600">Стр. {currentPage} из {totalPages}</span>
              <button onClick={() => { handleFilterClick(setCurrentPage, (p: number) => Math.min(totalPages, p + 1)); }} disabled={currentPage === totalPages} className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md disabled:opacity-50">Вперед</button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}