"use client";

import { useState, useEffect } from "react";
import { calculateTax } from "@/lib/tax";

const EXPENSE_CATEGORIES = [
  "Tools & Equipment", "Transportation", "Phone & Internet", "Uniform/Clothing",
  "Training", "Insurance", "Home Office", "Other",
];

interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string;
  date: string;
}

export default function TaxPage() {
  const [grossIncome, setGrossIncome] = useState(0);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [form, setForm] = useState({ description: "", amount: "", category: EXPENSE_CATEGORIES[0], date: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/expenses")
      .then((r) => r.json())
      .then((data) => setExpenses(data ?? []));
  }, []);

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const tax = calculateTax(grossIncome, totalExpenses);

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount), date: new Date(form.date).toISOString() }),
    });
    if (res.ok) {
      const saved = await res.json();
      setExpenses((prev) => [saved, ...prev]);
      setForm({ description: "", amount: "", category: EXPENSE_CATEGORIES[0], date: "" });
    }
    setSaving(false);
  }

  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const pct = (n: number) => (n * 100).toFixed(1) + "%";

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Tax Calculator</h1>
      <p className="text-gray-500 mb-8 text-sm">1099 self-employment tax estimator — 2024 tax year</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Income</h2>
          <label className="block text-sm font-medium text-gray-700 mb-1">Gross Income (Year to Date)</label>
          <input type="number" min={0} step={100} value={grossIncome || ""}
            onChange={(e) => setGrossIncome(parseFloat(e.target.value) || 0)}
            placeholder="0.00"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Tax Summary</h2>
          <dl className="space-y-2 text-sm">
            {[
              { label: "Gross Income", value: fmt(tax.grossIncome) },
              { label: "Total Expenses", value: fmt(tax.totalExpenses), cls: "text-green-600" },
              { label: "Net Income", value: fmt(tax.netIncome), bold: true },
              { label: "Self-Employment Tax (15.3%)", value: fmt(tax.selfEmploymentTax), cls: "text-red-600" },
              { label: "Federal Income Tax (est.)", value: fmt(tax.federalIncomeTax), cls: "text-red-600" },
              { label: "Total Tax Owed", value: fmt(tax.estimatedTotalTax), bold: true, cls: "text-red-700" },
              { label: "Effective Rate", value: pct(tax.effectiveRate) },
              { label: "Quarterly Payment", value: fmt(tax.quarterlyPayment), bold: true, cls: "text-blue-700" },
            ].map(({ label, value, bold, cls }) => (
              <div key={label} className={`flex justify-between ${bold ? "pt-2 border-t border-gray-100 font-semibold" : ""}`}>
                <dt className="text-gray-600">{label}</dt>
                <dd className={cls ?? "text-gray-900"}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Business Expenses</h2>
        <form onSubmit={addExpense} className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <input type="text" placeholder="Description" value={form.description} required
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="col-span-2 sm:col-span-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="number" placeholder="Amount" min={0.01} step={0.01} value={form.amount} required
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input type="date" value={form.date} required
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="submit" disabled={saving}
            className="col-span-2 sm:col-span-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? "Saving..." : "Add Expense"}
          </button>
        </form>

        {expenses.length === 0 ? (
          <p className="text-sm text-gray-400">No expenses logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-2 font-medium">Description</th>
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 text-gray-900">{e.description}</td>
                    <td className="py-2 text-gray-500">{e.category}</td>
                    <td className="py-2 text-gray-500">{new Date(e.date).toLocaleDateString()}</td>
                    <td className="py-2 text-right font-medium text-green-600">{fmt(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold">
                  <td colSpan={3} className="pt-2 text-gray-900">Total Expenses</td>
                  <td className="pt-2 text-right text-green-600">{fmt(totalExpenses)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
