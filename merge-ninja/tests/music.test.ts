import { describe, expect, it } from 'vitest';
import { MUSIC_FACTS, MUSIC_TRACKS, musicTrackForStage } from '../src/audio/Music';

/**
 * The composition itself is data; these checks pin its shape so a retune
 * cannot silently break the 16-bar loop or the scheduler's assumptions.
 */
describe('music composition facts', () => {
  it('is a sixteen-bar loop at 132 BPM', () => {
    expect(MUSIC_FACTS.bars).toBe(16);
    expect(MUSIC_FACTS.loopSteps).toBe(16 * 16);
    expect(MUSIC_FACTS.bpm).toBe(132);
    // One sixteenth note at 132 BPM leaves comfortable scheduler headroom.
    expect(MUSIC_FACTS.stepSec).toBeCloseTo(60 / 132 / 4, 6);
  });

  it('carries a dense lead line inside the loop bounds', () => {
    expect(MUSIC_FACTS.leadNotes).toBeGreaterThanOrEqual(48);
  });

  it('keeps the bass contour aligned with eight-note positions', () => {
    expect(MUSIC_FACTS.bassContour).toBe(8);
  });

  it('has a distinct composition for every arena act plus results', () => {
    expect(MUSIC_FACTS.tracks).toBe(6);
    expect(new Set(Object.values(MUSIC_TRACKS).map((track) => track.bpm)).size).toBe(6);
    for (const track of Object.values(MUSIC_TRACKS)) {
      expect(track.chords.length).toBeGreaterThanOrEqual(16);
      expect(track.chords.length % 2).toBe(0);
      expect(track.chords.every((chord) => chord.voices.length >= 4)).toBe(true);
      expect(track.lead.length).toBeGreaterThanOrEqual(12);
      expect(track.bass).toHaveLength(8);
    }
  });

  it('routes arena chapters to their own track at exact boundaries', () => {
    expect(musicTrackForStage(1)).toBe('dojo');
    expect(musicTrackForStage(9)).toBe('dojo');
    expect(musicTrackForStage(10)).toBe('mountain');
    expect(musicTrackForStage(19)).toBe('storm');
    expect(musicTrackForStage(28)).toBe('rift');
    expect(musicTrackForStage(37)).toBe('shrine');
  });
});
