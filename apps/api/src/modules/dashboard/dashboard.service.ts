import { eq, and, gte, lt, sql, count, sum, isNotNull } from "drizzle-orm";
import { db } from "../../config/supabase.js";
import {
  bookings,
  clients,
  conversations,
  messages,
  payments,
  services,
} from "@studio/db";

/** Returns start/end Date for a given YYYY-MM string */
function getMonthRange(month: string): { startDate: Date; endDate: Date } {
  const [year, m] = month.split("-").map(Number);
  const startDate = new Date(year, m - 1, 1);
  const endDate = new Date(year, m, 1);
  return { startDate, endDate };
}

/** Returns the previous month in YYYY-MM format */
function getPreviousMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function getTotalContacts(startDate: Date, endDate: Date) {
  const [row] = await db
    .select({ value: count() })
    .from(conversations)
    .where(and(gte(conversations.createdAt, startDate), lt(conversations.createdAt, endDate)));
  return row.value;
}

async function getMessagesSent(startDate: Date, endDate: Date) {
  const [row] = await db
    .select({ value: count() })
    .from(messages)
    .where(
      and(
        eq(messages.role, "sophia"),
        gte(messages.createdAt, startDate),
        lt(messages.createdAt, endDate)
      )
    );
  return row.value;
}

async function getTotalBookings(startDate: Date, endDate: Date) {
  const [row] = await db
    .select({ value: count() })
    .from(bookings)
    .where(and(gte(bookings.createdAt, startDate), lt(bookings.createdAt, endDate)));
  return row.value;
}

async function getContactsWithBookings(startDate: Date, endDate: Date) {
  const [row] = await db
    .select({ value: sql<number>`count(distinct ${conversations.id})` })
    .from(conversations)
    .innerJoin(clients, eq(conversations.clientId, clients.id))
    .innerJoin(bookings, eq(bookings.clientId, clients.id))
    .where(
      and(
        gte(conversations.createdAt, startDate),
        lt(conversations.createdAt, endDate),
        gte(bookings.createdAt, startDate),
        lt(bookings.createdAt, endDate)
      )
    );
  return Number(row.value) || 0;
}

async function getRevenue(startDate: Date, endDate: Date) {
  const [row] = await db
    .select({ value: sum(payments.amount) })
    .from(payments)
    .where(
      and(
        eq(payments.status, "confirmado"),
        gte(payments.paidAt, startDate),
        lt(payments.paidAt, endDate)
      )
    );
  return parseFloat(row.value ?? "0");
}

async function getHandoffCount(startDate: Date, endDate: Date) {
  const [row] = await db
    .select({ value: count() })
    .from(conversations)
    .where(
      and(
        gte(conversations.createdAt, startDate),
        lt(conversations.createdAt, endDate),
        eq(conversations.isHandoff, true)
      )
    );
  return row.value;
}

async function getBookingsByType(startDate: Date, endDate: Date) {
  return db
    .select({ type: services.type, count: count() })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(and(gte(bookings.createdAt, startDate), lt(bookings.createdAt, endDate)))
    .groupBy(services.type);
}

async function getBookingsByStatus(startDate: Date, endDate: Date) {
  return db
    .select({ status: bookings.status, count: count() })
    .from(bookings)
    .where(and(gte(bookings.createdAt, startDate), lt(bookings.createdAt, endDate)))
    .groupBy(bookings.status);
}

async function getIntentDistribution(startDate: Date, endDate: Date) {
  return db
    .select({ intent: conversations.intent, count: count() })
    .from(conversations)
    .where(
      and(
        gte(conversations.createdAt, startDate),
        lt(conversations.createdAt, endDate),
        isNotNull(conversations.intent)
      )
    )
    .groupBy(conversations.intent);
}

async function getTopServices(startDate: Date, endDate: Date) {
  return db
    .select({
      serviceId: services.id,
      name: services.name,
      count: count(),
      revenue: sum(payments.amount),
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(
        gte(bookings.createdAt, startDate),
        lt(bookings.createdAt, endDate),
        eq(payments.status, "confirmado")
      )
    )
    .groupBy(services.id, services.name)
    .orderBy(sql`count(*) desc`)
    .limit(10);
}

async function getPaymentMethods(startDate: Date, endDate: Date) {
  return db
    .select({
      method: payments.method,
      count: count(),
      total: sum(payments.amount),
    })
    .from(payments)
    .where(
      and(
        eq(payments.status, "confirmado"),
        gte(payments.paidAt, startDate),
        lt(payments.paidAt, endDate),
        isNotNull(payments.method)
      )
    )
    .groupBy(payments.method);
}

async function getDailyTrend(startDate: Date, endDate: Date) {
  const bookingRows = await db
    .select({
      date: sql<string>`to_char(${payments.paidAt}, 'YYYY-MM-DD')`,
      bookings: count(),
      revenue: sum(payments.amount),
    })
    .from(payments)
    .innerJoin(bookings, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(payments.status, "confirmado"),
        gte(payments.paidAt, startDate),
        lt(payments.paidAt, endDate)
      )
    )
    .groupBy(sql`to_char(${payments.paidAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${payments.paidAt}, 'YYYY-MM-DD')`);

  const contactRows = await db
    .select({
      date: sql<string>`to_char(${conversations.createdAt}, 'YYYY-MM-DD')`,
      contacts: count(),
    })
    .from(conversations)
    .where(and(gte(conversations.createdAt, startDate), lt(conversations.createdAt, endDate)))
    .groupBy(sql`to_char(${conversations.createdAt}, 'YYYY-MM-DD')`);

  // Merge and fill all days in the month
  const contactMap = new Map(contactRows.map((r) => [r.date, r.contacts]));
  const bookingMap = new Map(
    bookingRows.map((r) => [r.date, { bookings: r.bookings, revenue: parseFloat(r.revenue ?? "0") }])
  );

  const days: Array<{ date: string; bookings: number; revenue: number; contacts: number }> = [];
  const cursor = new Date(startDate);
  while (cursor < endDate) {
    const dateStr = cursor.toISOString().split("T")[0];
    const bk = bookingMap.get(dateStr);
    days.push({
      date: dateStr,
      bookings: bk?.bookings ?? 0,
      revenue: bk?.revenue ?? 0,
      contacts: contactMap.get(dateStr) ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

async function getKPIs(startDate: Date, endDate: Date) {
  const [totalContacts, messagesSent, totalBookings, contactsWithBookings, revenue, handoffCount] =
    await Promise.all([
      getTotalContacts(startDate, endDate),
      getMessagesSent(startDate, endDate),
      getTotalBookings(startDate, endDate),
      getContactsWithBookings(startDate, endDate),
      getRevenue(startDate, endDate),
      getHandoffCount(startDate, endDate),
    ]);

  const conversionRate = totalContacts > 0 ? (contactsWithBookings / totalContacts) * 100 : 0;
  const handoffRate = totalContacts > 0 ? (handoffCount / totalContacts) * 100 : 0;

  return {
    totalContacts,
    messagesSent,
    totalBookings,
    conversionRate: Math.round(conversionRate * 10) / 10,
    totalRevenue: revenue,
    handoffRate: Math.round(handoffRate * 10) / 10,
  };
}

export async function getMetrics(month: string) {
  const { startDate, endDate } = getMonthRange(month);
  const prevMonth = getPreviousMonth(month);
  const { startDate: prevStart, endDate: prevEnd } = getMonthRange(prevMonth);

  const [
    kpis,
    previousMonth,
    bookingsByType,
    bookingsByStatus,
    intentDistribution,
    topServices,
    paymentMethods,
    dailyTrend,
  ] = await Promise.all([
    getKPIs(startDate, endDate),
    getKPIs(prevStart, prevEnd),
    getBookingsByType(startDate, endDate),
    getBookingsByStatus(startDate, endDate),
    getIntentDistribution(startDate, endDate),
    getTopServices(startDate, endDate),
    getPaymentMethods(startDate, endDate),
    getDailyTrend(startDate, endDate),
  ]);

  return {
    period: {
      month,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    kpis,
    previousMonth,
    bookingsByType,
    bookingsByStatus,
    intentDistribution,
    topServices: topServices.map((s) => ({
      ...s,
      revenue: parseFloat(s.revenue ?? "0"),
    })),
    paymentMethods: paymentMethods.map((p) => ({
      ...p,
      method: p.method ?? "desconhecido",
      total: parseFloat(p.total ?? "0"),
    })),
    dailyTrend,
  };
}
