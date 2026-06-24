import { getHealthReport } from '../../../src/health';

export async function GET() {
  return Response.json(await getHealthReport());
}
