import { AppLayout } from "@/components/AppLayout";
import { StatCard } from "@/components/StatCard";
import { payments } from "@/lib/mock-data";
import { ArrowDownLeft, ArrowUpRight, TrendingUp, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function FinancesPage() {
  const income = payments.filter((p) => p.type === "income");
  const expenses = payments.filter((p) => p.type === "expense");
  const totalIncome = income.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const totalExpense = expenses.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const profit = totalIncome - totalExpense;
  const pendingAmount = payments.filter(p => p.status === "pending").reduce((s, p) => s + p.amount, 0);

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Фінанси</h1>
        <p className="text-sm text-muted-foreground">Оплати та виплати</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Надходження" value={`${totalIncome} ₴`} icon={ArrowDownLeft} variant="success" />
        <StatCard label="Виплати" value={`${totalExpense} ₴`} icon={ArrowUpRight} />
        <StatCard label="Прибуток" value={`${profit} ₴`} icon={TrendingUp} variant="success" />
        <StatCard label="Очікується" value={`${pendingAmount} ₴`} icon={DollarSign} variant="warning" />
      </div>

      {/* Income */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-semibold text-foreground mb-4">Надходження від учнів</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Учень</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Опис</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Дата</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Сума</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Статус</th>
              </tr>
            </thead>
            <tbody>
              {income.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{p.personName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.description}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.date}</td>
                  <td className="px-4 py-3 text-right font-semibold text-success">+{p.amount} ₴</td>
                  <td className="px-4 py-3 text-right">
                    <Badge className={p.status === "paid" ? "bg-success/10 text-success border-0" : "bg-warning/10 text-warning border-0"}>
                      {p.status === "paid" ? "Оплачено" : "Очікує"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expenses */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-semibold text-foreground mb-4">Виплати репетиторам</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Репетитор</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Опис</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Дата</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Сума</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Статус</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{p.personName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.description}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.date}</td>
                  <td className="px-4 py-3 text-right font-semibold text-destructive">-{p.amount} ₴</td>
                  <td className="px-4 py-3 text-right">
                    <Badge className={p.status === "paid" ? "bg-success/10 text-success border-0" : "bg-warning/10 text-warning border-0"}>
                      {p.status === "paid" ? "Оплачено" : "Очікує"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
