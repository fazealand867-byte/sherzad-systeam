import { NextResponse } from 'next/server';
import { getDashboardAnalytics, generateFullSystemReport } from '@/lib/services/dashboard.service';
import { handleApiError, requireApiPermission } from '@/lib/server-auth';

export async function GET(request: Request) {
  try {
    await requireApiPermission('dashboard.view');
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');
    const startDate = searchParams.get('startDate')
      ? new Date(searchParams.get('startDate')!)
      : undefined;
    const endDate = searchParams.get('endDate')
      ? new Date(searchParams.get('endDate')!)
      : undefined;

    if (mode === 'fullReport') {
      await requireApiPermission('reports.view');
      const report = await generateFullSystemReport({ startDate, endDate });
      return NextResponse.json(report);
    }

    const analytics = await getDashboardAnalytics();
    return NextResponse.json(analytics);
  } catch (error) {
    return handleApiError(error);
  }
}
