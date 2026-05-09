// PURPOSE: Health check endpoint — для load balancer и мониторинга
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'open-finance',
    version: '0.4.0',
    timestamp: new Date().toISOString(),
  });
}
