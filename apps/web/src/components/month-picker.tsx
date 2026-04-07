"use client";

import { useRouter, useSearchParams } from "next/navigation";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function parseMonth(month: string) {
  const [year, m] = month.split("-").map(Number);
  return { year, month: m };
}

function shiftMonth(month: string, delta: number) {
  const { year, month: m } = parseMonth(month);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string) {
  const { year, month: m } = parseMonth(month);
  return `${MONTH_NAMES[m - 1]} ${year}`;
}

export function MonthPicker({ currentMonth }: { currentMonth: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(newMonth: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", newMonth);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="month-picker">
      <button
        className="btn btn-secondary month-picker-btn"
        onClick={() => navigate(shiftMonth(currentMonth, -1))}
        aria-label="Mes anterior"
      >
        &larr;
      </button>
      <span className="month-picker-label">{formatMonthLabel(currentMonth)}</span>
      <button
        className="btn btn-secondary month-picker-btn"
        onClick={() => navigate(shiftMonth(currentMonth, 1))}
        aria-label="Proximo mes"
      >
        &rarr;
      </button>
    </div>
  );
}
