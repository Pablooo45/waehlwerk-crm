import { describe, expect, it } from 'vitest';
import { demoDialogRecording } from './demoAudio.ts';
import { talkShare } from './analysis.ts';

describe('Beispielaufnahmen', () => {
  it('haben eine sichtbare Wellenform und einen Redeanteil', () => {
    const rec = demoDialogRecording('gatekeeper', { agent: 'Mia', kunde: 'Frau Becker' }, 42);
    const maxA = Math.max(...rec.peaks.agent);
    const maxC = Math.max(...rec.peaks.customer);
    expect(maxA).toBeGreaterThan(80);
    expect(maxC).toBeGreaterThan(80);
    const share = talkShare(rec.talk);
    expect(share).not.toBeNull();
    expect(share!).toBeGreaterThan(0.2);
    expect(share!).toBeLessThan(0.8);
  });
});
