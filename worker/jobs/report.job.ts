import { publishPosEvent } from '../../config/redis.client';
import { dailySales } from '../../app/services/report.service';

export type DailyReportJobData = {
  date?: string;
};

function yesterdayIso(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function runDailyReportJob(data: DailyReportJobData): Promise<void> {
  const date = data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : yesterdayIso();

  const report = await dailySales(date);

  await publishPosEvent({
    type: 'report:daily:completed',
    data: { ...report },
  });

  process.stdout.write(
    `[report:daily] ${date}: ${report.orderCount} orders, revenue ${report.totalCents} cents\n`,
  );
}
