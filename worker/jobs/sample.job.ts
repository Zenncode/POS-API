export type SampleJobResult = {
  ok: true;
  job: 'sample';
  ranAt: string;
};

export async function runSampleJob(): Promise<SampleJobResult> {
  return {
    ok: true,
    job: 'sample',
    ranAt: new Date().toISOString(),
  };
}
