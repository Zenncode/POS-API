import { describe, expect, it } from '@jest/globals';
import { runSampleJob } from '../../worker/jobs/sample.job';

describe('sample worker job', () => {
  it('completes with an ok result', async () => {
    const result = await runSampleJob();

    expect(result.ok).toBe(true);
    expect(result.job).toBe('sample');
    expect(Number.isNaN(Date.parse(result.ranAt))).toBe(false);
  });
});
