'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

const ExpensePieChart = dynamic(() => import('@/components/ExpensePieChart'), { ssr: false });
const MonthlyBarChart = dynamic(() => import('@/components/MonthlyBarChart'), { ssr: false });

type TxKind = 'income' | 'expense' | 'transfer';
type TypeFilter = 'all' | TxKind;
type SortKey = 'timestamp-desc' | 'timestamp-asc' | 'amount-desc' | 'amount-asc';

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  HapticFeedback?: { impactOccurred: (style: 'light' | 'medium' | 'heavy') => void };
}

interface TelegramWindow {
  WebApp?: TelegramWebApp;
}

declare global {
  interface Window {
    Telegram?: TelegramWindow;
  }
}

interface Transaction {
  id: string;
  user_id: string;
  category: string;
  title: string;
  amount: number | string;
  currency: string;
  timestamp: string;
  day: string;
  kind: TxKind;
  created_at: string;
  updated_at: string;
}

interface FxExchange {
  id: string;
  from_currency: string;
  from_amount: number | string;
  to_currency: string;
  to_amount: number | string;
  actual_rate: number | string;
  market_rate: number | string | null;
  rate_diff_pct: number | string | null;
  loss_in_from: number | string | null;
  note: string | null;
  exchanged_at: string;
}

interface TransactionsApiResponse {
  transactions?: Transaction[];
  defaultCurrency?: string | null;
  error?: string;
}

interface RatesApiResponse {
  base?: string;
  rates?: Record<string, number>;
  error?: string;
}

interface CurrencyBalance {
  currency: string;
  current_balance: number | string;
}

interface BalancesApiResponse {
  balances?: CurrencyBalance[];
  error?: string;
}

const ITEMS_PER_PAGE = 10;

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const TODAY = localDate(new Date());

const kindConfig: Record<TxKind, { label: string; color: string; bg: string; sign: string }> = {
  income: { label: 'Доход', color: 'text-teal-600', bg: 'bg-teal-50', sign: '+' },
  expense: { label: 'Расход', color: 'text-rose-500', bg: 'bg-rose-50', sign: '−' },
  transfer: { label: 'Перевод', color: 'text-slate-500', bg: 'bg-slate-100', sign: '⇄' },
};

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function haptic(): void {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
  } catch {
    // no-op
  }
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={() => {
        haptic();
        onClick();
      }}
      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-150 cursor-pointer select-none ${active ? 'bg-slate-800 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 active:bg-slate-300'}`}
    >
      {children}
    </button>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-400">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-slate-700 focus:outline-none focus:border-indigo-400"
      />
    </div>
  );
}

export default function Home() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [exchanges, setExchanges] = useState<FxExchange[]>([]);
  const [currencyBalances, setCurrencyBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportCurrency, setReportCurrency] = useState<string>('all');
  const [selectedDisplayCurrency, setSelectedDisplayCurrency] = useState<string | null>(null);
  const [displayRates, setDisplayRates] = useState<Record<string, number>>({});
  const [dateFrom, setDateFrom] = useState(() => {
    const n = new Date();
    return localDate(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 30));
  });
  const [dateTo, setDateTo] = useState(TODAY);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('timestamp-desc');
  const [currentPage, setCurrentPage] = useState(1);

  const resetPage = (): void => setCurrentPage(1);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        window.Telegram?.WebApp?.ready?.();
        window.Telegram?.WebApp?.expand?.();

        const initData = window.Telegram?.WebApp?.initData ?? null;
        const isDev = process.env.NODE_ENV === 'development';
        if (!initData && !isDev) {
          throw new Error('Открой в Telegram');
        }

        const headers: Record<string, string> = initData ? { Authorization: `Tma ${initData}` } : {};
        const [txResp, fxResp, balancesResp] = await Promise.all([
          fetch('/api/transactions', { headers }),
          fetch('/api/fx-exchanges', { headers }),
          fetch('/api/balances', { headers }),
        ]);

        const txData = (await txResp.json()) as TransactionsApiResponse;
        const fxData = (await fxResp.json()) as unknown;
        const balancesData = (await balancesResp.json()) as BalancesApiResponse;

        if (txData.error) throw new Error(txData.error);
        if (balancesData.error) throw new Error(balancesData.error);

        const txPayload = txData.transactions ?? [];
        const txList = Array.isArray(txPayload) ? txPayload : [];
        const fxList = Array.isArray(fxData) ? (fxData as FxExchange[]) : [];
        const balancesList = Array.isArray(balancesData.balances) ? balancesData.balances : [];
        const balancesMap = Object.fromEntries(
          balancesList.map((row) => [row.currency, toNumber(row.current_balance)]),
        ) as Record<string, number>;

        if (!cancelled) {
          setTransactions(txList);
          setExchanges(fxList);
          setCurrencyBalances(balancesMap);
          const currencies = [...new Set([...txList.map((tx) => tx.currency), ...Object.keys(balancesMap)])];
          setReportCurrency(currencies.length === 1 ? currencies[0] : 'all');
        }
      } catch (e: unknown) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableCurrencies = useMemo(
    () => [...new Set([...transactions.map((tx) => tx.currency), ...Object.keys(currencyBalances)])],
    [transactions, currencyBalances],
  );

  useEffect(() => {
    let cancelled = false;
    const loadDisplayRates = async (): Promise<void> => {
      if (!selectedDisplayCurrency) return;
      const unique = availableCurrencies.filter((s) => s !== selectedDisplayCurrency);
      if (unique.length === 0) {
        if (!cancelled) setDisplayRates({ [selectedDisplayCurrency]: 1 });
        return;
      }

      try {
        const resp = await fetch(`/api/rates?base=${selectedDisplayCurrency}&symbols=${unique.join(',')}`);
        const data = (await resp.json()) as RatesApiResponse;
        if (!cancelled && data.rates) setDisplayRates(data.rates);
      } catch {
        if (!cancelled) setDisplayRates({});
      }
    };

    void loadDisplayRates();
    return () => {
      cancelled = true;
    };
  }, [selectedDisplayCurrency, availableCurrencies]);

  const filteredTx = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;
    return transactions.filter((tx) => {
      const d = new Date(tx.timestamp);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [transactions, dateFrom, dateTo]);

  const statsTx = useMemo(() => {
    if (reportCurrency === 'all') {
      if (!selectedDisplayCurrency) return [] as Transaction[];
      return filteredTx
        .filter((tx) => tx.kind !== 'transfer')
        .flatMap((tx) => {
          if (tx.currency === selectedDisplayCurrency) return [tx];
          const rate = displayRates[tx.currency];
          if (!rate) return [];
          return [{ ...tx, amount: toNumber(tx.amount) / rate, currency: selectedDisplayCurrency }];
        });
    }
    return filteredTx.filter((tx) => tx.currency === reportCurrency && tx.kind !== 'transfer');
  }, [filteredTx, reportCurrency, selectedDisplayCurrency, displayRates]);

  const { totalIncome, totalExpenses, balance } = useMemo(() => {
    let income = 0;
    let expenses = 0;
    statsTx.forEach((tx) => {
      const amount = toNumber(tx.amount);
      if (tx.kind === 'income') income += amount;
      else if (tx.kind === 'expense') expenses += amount;
    });
    return { totalIncome: income, totalExpenses: expenses, balance: income - expenses };
  }, [statsTx]);

  const expenseCategoriesData = useMemo(() => {
    const cats: Record<string, number> = {};
    statsTx.forEach((tx) => {
      const amount = toNumber(tx.amount);
      if (tx.kind !== 'expense' || amount <= 0) return;
      cats[tx.category] = (cats[tx.category] || 0) + amount;
    });
    return Object.entries(cats).map(([name, value]) => ({ name, value }));
  }, [statsTx]);

  const processedTx = useMemo(() => {
    const list = typeFilter === 'all' ? [...filteredTx] : filteredTx.filter((tx) => tx.kind === typeFilter);
    const [key, dir] = sortKey.split('-') as ['timestamp' | 'amount', 'asc' | 'desc'];

    list.sort((a, b) => {
      const va = key === 'amount' ? toNumber(a.amount) : new Date(a.timestamp).getTime();
      const vb = key === 'amount' ? toNumber(b.amount) : new Date(b.timestamp).getTime();
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [filteredTx, typeFilter, sortKey]);

  const totalPages = Math.ceil(processedTx.length / ITEMS_PER_PAGE);
  const safePage = Math.min(Math.max(currentPage, 1), Math.max(totalPages, 1));
  const paginatedTx = processedTx.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  const fxLoss = useMemo(
    () => exchanges.reduce((sum, ex) => sum + toNumber(ex.loss_in_from), 0),
    [exchanges],
  );

  const dashboardCurrency = reportCurrency === 'all' ? selectedDisplayCurrency ?? '' : reportCurrency;
  const snapshotBalance = useMemo(() => {
    if (reportCurrency === 'all') {
      if (!selectedDisplayCurrency) return null;
      let total = 0;
      for (const [currency, value] of Object.entries(currencyBalances)) {
        if (currency === selectedDisplayCurrency) {
          total += value;
          continue;
        }
        const rate = displayRates[currency];
        if (rate) total += value / rate;
      }
      return total;
    }
    if (currencyBalances[reportCurrency] !== undefined) {
      return currencyBalances[reportCurrency];
    }
    return null;
  }, [reportCurrency, selectedDisplayCurrency, currencyBalances, displayRates]);
  const balanceValue = snapshotBalance ?? balance;

  const now = new Date();
  const d30 = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
  const d90 = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90));
  const d365 = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 365));

  const isMonth = dateFrom === d30 && dateTo === TODAY;
  const isQuarter = dateFrom === d90 && dateTo === TODAY;
  const isYear = dateFrom === d365 && dateTo === TODAY;
  const isAll = dateFrom === '' && dateTo === '';

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Загрузка...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-rose-500 text-sm text-center px-6">{error}</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-6 font-sans">
      <div className="w-full max-w-2xl mx-auto">
        <div className="px-4 pt-6 pb-4">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-1">Личный трекер</p>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Финансы</h1>
        </div>

        <div className="px-4 mb-4 space-y-3">
          <div className="flex gap-3 flex-wrap items-end">
            <DateInput label="С" value={dateFrom} onChange={(v) => { setDateFrom(v); resetPage(); }} />
            <DateInput label="По" value={dateTo} onChange={(v) => { setDateTo(v); resetPage(); }} />
            <div className="flex gap-1.5 flex-wrap">
              <PillButton active={isMonth} onClick={() => { setDateFrom(d30); setDateTo(TODAY); resetPage(); }}>30 дн.</PillButton>
              <PillButton active={isQuarter} onClick={() => { setDateFrom(d90); setDateTo(TODAY); resetPage(); }}>90 дн.</PillButton>
              <PillButton active={isYear} onClick={() => { setDateFrom(d365); setDateTo(TODAY); resetPage(); }}>365 дн.</PillButton>
              <PillButton active={isAll} onClick={() => { setDateFrom(''); setDateTo(''); resetPage(); }}>Всё</PillButton>
            </div>
          </div>

          {availableCurrencies.length > 0 && (
            <div className="flex gap-1.5 flex-wrap items-center">
              {availableCurrencies.map((c) => (
                <PillButton
                  key={c}
                  active={reportCurrency === c}
                  onClick={() => {
                    setReportCurrency(c);
                    setSelectedDisplayCurrency(null);
                    resetPage();
                  }}
                >
                  {c}
                </PillButton>
              ))}
              {availableCurrencies.length > 1 && (
                <select
                  value={reportCurrency === 'all' ? (selectedDisplayCurrency ?? '') : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      setReportCurrency('all');
                      setSelectedDisplayCurrency(v);
                      resetPage();
                    }
                  }}
                  className={`text-xs border rounded-full px-3 py-1.5 font-medium transition-all duration-150 cursor-pointer ${
                    reportCurrency === 'all' && selectedDisplayCurrency
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-slate-100 text-slate-500 border-transparent hover:bg-slate-200'
                  }`}
                >
                  <option value="">Все→</option>
                  {availableCurrencies.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        <div className="px-4 space-y-4">
          {(statsTx.length > 0 || snapshotBalance !== null) ? (
            <>
              <div className="bg-slate-900 rounded-3xl p-5 text-white">
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center">
                    <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">Доходы</div>
                    <div className="text-xl font-bold text-teal-400">{totalIncome.toFixed(0)}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{dashboardCurrency}</div>
                  </div>
                  <div className="text-center border-x border-slate-700">
                    <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">Расходы</div>
                    <div className="text-xl font-bold text-rose-400">{totalExpenses.toFixed(0)}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{dashboardCurrency}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">Итог</div>
                    <div className={`text-xl font-bold ${balanceValue >= 0 ? 'text-teal-400' : 'text-rose-400'}`}>
                      {balanceValue >= 0 ? '+' : ''}{balanceValue.toFixed(0)}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{dashboardCurrency}</div>
                  </div>
                </div>
              </div>

              {exchanges.length > 0 && reportCurrency !== 'all' && (
                <div className="bg-amber-50 rounded-2xl p-4 flex justify-between items-center">
                  <div>
                    <div className="text-xs font-semibold text-amber-700">Потери на обменах</div>
                    <div className="text-xs text-amber-500 mt-0.5">{exchanges.length} операций</div>
                  </div>
                  <div className="text-base font-bold text-amber-600">−{fxLoss.toFixed(2)}</div>
                </div>
              )}

              {statsTx.length > 0 && (
                <>
                  <div className="bg-white rounded-2xl p-4">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Расходы по категориям</div>
                    <ExpensePieChart
                      data={expenseCategoriesData}
                      currency={dashboardCurrency}
                      totalExpenses={totalExpenses}
                      transactions={statsTx}
                    />
                  </div>

                  <div className="bg-white rounded-2xl p-4">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Динамика</div>
                    <MonthlyBarChart transactions={statsTx} currency={dashboardCurrency} />
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="bg-white rounded-2xl p-4 text-center text-slate-400 text-sm">
              {reportCurrency === 'all' ? 'Выбери валюту в списке выше →' : 'Нет данных'}
            </div>
          )}
        </div>

        <div className="px-4 space-y-3 mt-4">
          <div className="flex gap-1.5 flex-wrap items-center justify-between">
            <div className="flex gap-1.5">
              {(['all', 'income', 'expense', 'transfer'] as const).map((k) => (
                <PillButton
                  key={k}
                  active={typeFilter === k}
                  onClick={() => {
                    setTypeFilter(k);
                    resetPage();
                  }}
                >
                  {k === 'all' ? 'Все' : kindConfig[k].label}
                </PillButton>
              ))}
            </div>
            <select
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value as SortKey);
                resetPage();
              }}
              className="text-xs bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-slate-500 cursor-pointer"
            >
              <option value="timestamp-desc">Новые</option>
              <option value="timestamp-asc">Старые</option>
              <option value="amount-desc">Сумма ↓</option>
              <option value="amount-asc">Сумма ↑</option>
            </select>
          </div>

          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {paginatedTx.length === 0 ? (
              <p className="text-center text-slate-400 py-10 text-sm">Нет операций</p>
            ) : (
              paginatedTx.map((tx, i) => {
                const cfg = kindConfig[tx.kind];
                return (
                  <div key={tx.id} className={`flex items-center px-4 py-3 ${i < paginatedTx.length - 1 ? 'border-b border-slate-50' : ''}`}>
                    <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center text-sm font-bold ${cfg.color} mr-3 shrink-0`}>
                      {cfg.sign}
                    </div>
                    <div className="flex-grow min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{tx.title}</div>
                      <div className="text-xs text-slate-400">{tx.category} · {new Date(tx.timestamp).toLocaleDateString('ru-RU')}</div>
                    </div>
                    <div className={`text-sm font-semibold ml-2 shrink-0 ${cfg.color}`}>
                      {cfg.sign}{toNumber(tx.amount).toFixed(2)} {tx.currency}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-between items-center">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-4 py-1.5 bg-white rounded-xl text-sm text-slate-600 disabled:opacity-40 shadow-sm"
              >
                ← Назад
              </button>
              <span className="text-xs text-slate-400">{safePage} / {totalPages}</span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-4 py-1.5 bg-white rounded-xl text-sm text-slate-600 disabled:opacity-40 shadow-sm"
              >
                Вперёд →
              </button>
            </div>
          )}
        </div>

        <div className="px-4 space-y-3 mt-4">
          {exchanges.length === 0 ? (
            <div className="bg-white rounded-2xl p-6 text-center text-slate-400 text-sm">
              Нет записей об обменах.<br />Скажи боту: «поменяла 500 USD на 16500 THB»
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
                  <div className="text-xs text-slate-400 mb-1">Обменов всего</div>
                  <div className="text-xl font-bold text-slate-700">{exchanges.length}</div>
                </div>
                <div className="bg-amber-50 rounded-2xl p-4 shadow-sm text-center">
                  <div className="text-xs text-amber-500 mb-1">Потеряно на курсе</div>
                  <div className="text-xl font-bold text-amber-600">−{fxLoss.toFixed(2)}</div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                {exchanges.map((ex, i) => {
                  const diff = ex.rate_diff_pct != null ? toNumber(ex.rate_diff_pct) : null;
                  return (
                    <div key={ex.id} className={`px-4 py-3 ${i < exchanges.length - 1 ? 'border-b border-slate-50' : ''}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-sm font-semibold text-slate-800">
                            {toNumber(ex.from_amount).toFixed(2)} {ex.from_currency} → {toNumber(ex.to_amount).toFixed(2)} {ex.to_currency}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            Курс: {toNumber(ex.actual_rate).toFixed(4)}
                            {ex.market_rate != null && <> · Рынок: {toNumber(ex.market_rate).toFixed(4)}</>}
                            {ex.note && <> · {ex.note}</>}
                          </div>
                        </div>
                        <div className="text-right ml-3 shrink-0">
                          {diff != null && (
                            <div className={`text-xs font-semibold ${diff < 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(2)}%
                            </div>
                          )}
                          <div className="text-xs text-slate-400">{new Date(ex.exchanged_at).toLocaleDateString('ru-RU')}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
