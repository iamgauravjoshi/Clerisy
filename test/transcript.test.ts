import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/main/settings', () => ({}))
import { parseTranscript } from '../src/main/transcriptParser'
import { isEcho, mergeStreams } from '../src/main/stt'

describe('parseTranscript', () => {
  it('parses plain "Name: text" lines and merges continuations', () => {
    const segs = parseTranscript('Priya: We need SSO.\nIt is a must for enterprise.\nRahul: Agreed.')
    expect(segs.map((s) => [s.speaker, s.text])).toEqual([
      ['Priya', 'We need SSO. It is a must for enterprise.'],
      ['Rahul', 'Agreed.']
    ])
  })
  it('parses Teams VTT voice tags with timestamps', () => {
    const vtt =
      'WEBVTT\n\n00:00:01.000 --> 00:00:04.500\n<v Priya Shah>We need SSO.</v>\n\n00:00:05.000 --> 00:00:07.000\n<v Rahul>Agreed.</v>\n'
    const segs = parseTranscript(vtt)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ speaker: 'Priya Shah', text: 'We need SSO.', tStart: 1, tEnd: 4.5 })
  })
  it('parses SRT with speaker prefixes', () => {
    const srt = '1\n00:01:00,000 --> 00:01:03,000\nAnita: Budget is frozen.\n\n2\n00:01:04,000 --> 00:01:06,000\nAnita: Until Q3.\n'
    const segs = parseTranscript(srt)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ speaker: 'Anita', tStart: 60, text: 'Budget is frozen. Until Q3.' })
  })
  it('parses Zoom txt exports', () => {
    const segs = parseTranscript('[Priya] 00:02:10\nShip it Friday.\n[Rahul] 00:02:15\nOK.')
    expect(segs.map((s) => [s.speaker, s.tStart])).toEqual([
      ['Priya', 130],
      ['Rahul', 135]
    ])
  })
})

describe('mergeStreams', () => {
  it('drops mic echo of remote speech but keeps the local user', () => {
    const mic = [
      { speaker: 'Me', tStart: 0, tEnd: 3, text: 'Hi all, quick update from me', source: 'mic' as const },
      { speaker: 'Me', tStart: 10, tEnd: 13, text: 'launch moves to november twenty', source: 'mic' as const }
    ]
    const sys = [{ speaker: 'Speaker 1', tStart: 10.5, tEnd: 13, text: 'Launch moves to November twenty.', source: 'system' as const }]
    const out = mergeStreams(mic, sys)
    expect(out.map((s) => s.speaker)).toEqual(['Me', 'Speaker 1'])
  })
  it('drops a mic echo that spans several system segments', () => {
    // from a real recording: one mic line covered two system utterances, neither of which matched it on its own
    const mic = [
      {
        speaker: 'Me',
        tStart: 50.3,
        tEnd: 55.6,
        text: "as well. One other thing I wanted to talk about, there's a student I've noticed here, John Smith.",
        source: 'mic' as const
      }
    ]
    const sys = [
      {
        speaker: 'Speaker 1',
        tStart: 50.3,
        tEnd: 53,
        text: 'as well. So one other thing I wanted to talk about,',
        source: 'system' as const
      },
      {
        speaker: 'Speaker 1',
        tStart: 53.2,
        tEnd: 55.6,
        text: "there's a student I've noticed here, John Smith.",
        source: 'system' as const
      }
    ]
    expect(isEcho(mic[0], sys)).toBe(true)
    expect(mergeStreams(mic, sys).map((s) => s.source)).toEqual(['system', 'system'])
  })
  it('keeps local speech that overlaps remote speech in time', () => {
    const me = { tStart: 51, tEnd: 54, text: 'Sorry, can we come back to the budget first?' }
    const sys = [{ tStart: 50.3, tEnd: 55.6, text: "there's a student I've noticed here, John Smith." }]
    expect(isEcho(me, sys)).toBe(false)
  })
})

describe('parseTranscript labels', () => {
  it('keeps note labels like "Decision:" in the current speaker\'s line', () => {
    const segs = parseTranscript(
      'Priya: We talked it through.\nDecision: use Postgres for the backend.\nAction item: Rahul writes the migration plan.\nRahul: OK.'
    )
    expect(segs.map((s) => s.speaker)).toEqual(['Priya', 'Rahul'])
    expect(segs[0].text).toBe('We talked it through. Decision: use Postgres for the backend. Action item: Rahul writes the migration plan.')
  })
  it('does the same inside subtitle cues', () => {
    const vtt =
      'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nPriya: Ship Friday.\n\n00:00:03.500 --> 00:00:05.000\nNote: pending legal review\n'
    expect(parseTranscript(vtt).map((s) => [s.speaker, s.text])).toEqual([['Priya', 'Ship Friday. Note: pending legal review']])
  })
})

describe('fmtTime', () => {
  it('formats seconds as mm:ss, and h:mm:ss from one hour on', async () => {
    const { fmtTime } = await import('@shared/format')
    expect([fmtTime(0), fmtTime(17.9), fmtTime(754), fmtTime(3600), fmtTime(3725), fmtTime(-5)]).toEqual([
      '00:00',
      '00:17',
      '12:34',
      '1:00:00',
      '1:02:05',
      '00:00'
    ])
  })
})

describe('echo in Hindi', () => {
  const at = (text: string) => ({ tStart: 10, tEnd: 13, text })
  it('compares whole Devanagari words, so lines that differ only in vowel signs aren’t echoes', () => {
    expect(isEcho(at('वो की थी'), [at('वो का था')])).toBe(false)
    expect(isEcho(at('हमें कल से काम शुरू करना है'), [at('हमें कल से काम शुरू करना है')])).toBe(true)
  })
})
