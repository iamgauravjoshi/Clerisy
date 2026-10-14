import { type AnswerPoint, type AnswerQuote, type Item, MAX_QUESTION_LENGTH, type ProjectQuestion } from '@shared/types'
import { CornerDownRight, MessageCircleQuestion, SearchX, Sparkles, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { api } from '../../api'
import { Banner, Button, Card, EmptyState, Icon, IconButton, Spinner, Textarea, Timestamp, useConfirm } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { fmtTime } from '../../lib/format'
import { toneVars } from '../../lib/hues'
import { ITEM_TYPE_META } from '../../lib/labels'
import { speakerHue } from '../../lib/speakerColor'

const EXAMPLES = [
  'What decisions have we made so far?',
  'What is still open, and who owns it?',
  'What changed in the last meeting?',
  'Which deadlines moved, and why?'
]

/**
 * Ask the project: questions answered only from this project's state and meeting transcripts. Every point of an
 * answer shows its sources, items and verbatim quotes, which open the item or the line in the meeting.
 */
export function AskPanel({
  projectId,
  items,
  selfName,
  onOpenItem,
  onOpenMeeting
}: {
  projectId: string
  items: Item[] | null
  selfName?: string
  onOpenItem: (itemId: string) => void
  onOpenMeeting: (meetingId: string, segmentId: string) => void
}) {
  const [questions, setQuestions] = useState<ProjectQuestion[] | null>(null)
  const [draft, setDraft] = useState('')
  const [asking, setAsking] = useState<string | null>(null)
  const ask = useAction()
  const remove = useAction()
  const confirm = useConfirm()

  useEffect(() => {
    let live = true
    setQuestions(null)
    api
      .listQuestions(projectId)
      .then((q) => live && setQuestions(q))
      .catch(() => live && setQuestions([]))
    return () => {
      live = false
    }
  }, [projectId])

  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    const q = draft.trim()
    if (q.length < 3) return
    void ask.run(async () => {
      setAsking(q)
      try {
        const answer = await api.askProject(projectId, q)
        setQuestions((qs) => [answer, ...(qs ?? [])])
        setDraft('')
      } finally {
        setAsking(null)
      }
    })
  }

  const itemsById = new Map((items ?? []).map((i) => [i.id, i]))
  const error = ask.error ?? remove.error

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="ask-question" className="text-body-strong">
          Ask about this project
        </label>
        <div className="flex items-start gap-2">
          <Textarea
            id="ask-question"
            value={draft}
            maxLength={MAX_QUESTION_LENGTH}
            minRows={2}
            autoGrow
            placeholder="For example: why did we change the launch date?"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter asks; Shift+Enter starts a new line
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e)
            }}
            className="flex-1"
          />
          <Button type="submit" variant="primary" icon={Sparkles} loading={ask.busy} disabled={draft.trim().length < 3}>
            Ask
          </Button>
        </div>
        <p className="text-fg-tertiary text-small">
          Answers come only from this project's state and meeting transcripts, and every point shows where it comes from.
        </p>
      </form>

      {error && <Banner tone="danger">{error}</Banner>}

      {asking && (
        <Card className="flex flex-col gap-2" aria-busy="true">
          <p className="text-body-strong">{asking}</p>
          <p role="status" className="flex items-center gap-2 text-fg-secondary text-small">
            <Spinner /> Searching the project…
          </p>
        </Card>
      )}

      {questions?.length === 0 && !asking && (
        <EmptyState icon={MessageCircleQuestion} title="Ask anything about this project">
          <span className="flex flex-col items-center gap-3">
            Decisions, owners, deadlines, risks, or what a meeting changed. Try one of these:
            <span className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((x) => (
                <Button key={x} size="sm" onClick={() => setDraft(x)}>
                  {x}
                </Button>
              ))}
            </span>
          </span>
        </EmptyState>
      )}

      {questions?.map((q) => (
        <Card key={q.id} className="flex flex-col gap-3" aria-label={q.question} role="article">
          <header className="flex items-start gap-2">
            <h3 className="flex-1 text-body-strong">{q.question}</h3>
            <Timestamp iso={q.createdAt} className="pt-0.5 text-fg-tertiary text-small" />
            <IconButton
              icon={Trash2}
              label="Delete question"
              size="sm"
              onClick={() =>
                void remove.run(async () => {
                  const ok = await confirm({
                    title: 'Delete this question?',
                    body: 'The question and its answer are removed. The project itself doesn’t change.',
                    confirmLabel: 'Delete question',
                    tone: 'danger'
                  })
                  if (!ok) return
                  await api.deleteQuestion(q.id)
                  setQuestions((qs) => (qs ?? []).filter((x) => x.id !== q.id))
                })
              }
            />
          </header>
          {!q.answered && (
            <p className="flex items-center gap-2 text-fg-secondary">
              <Icon icon={SearchX} className="text-fg-tertiary" />
              The project's state and meetings don't answer this{q.points.length ? '. The closest facts:' : '.'}
            </p>
          )}
          {q.points.length > 0 && (
            <ul className="flex flex-col gap-3">
              {q.points.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: an answer's points never change order
                <Point key={i} point={p} itemsById={itemsById} selfName={selfName} onOpenItem={onOpenItem} onOpenMeeting={onOpenMeeting} />
              ))}
            </ul>
          )}
          {q.droppedCount > 0 && (
            <p className="text-fg-tertiary text-small">
              {q.droppedCount} point{q.droppedCount === 1 ? ' was' : 's were'} left out because no project item or transcript line backed{' '}
              {q.droppedCount === 1 ? 'it' : 'them'}.
            </p>
          )}
        </Card>
      ))}
    </div>
  )
}

function Point({
  point,
  itemsById,
  selfName,
  onOpenItem,
  onOpenMeeting
}: {
  point: AnswerPoint
  itemsById: Map<string, Item>
  selfName?: string
  onOpenItem: (itemId: string) => void
  onOpenMeeting: (meetingId: string, segmentId: string) => void
}) {
  return (
    <li className="flex flex-col gap-1.5">
      <p className="text-reading">{point.text}</p>
      {point.items.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {point.items.map((it) => {
            const meta = ITEM_TYPE_META[it.type]
            const now = itemsById.get(it.id)
            return (
              <button
                key={it.id}
                type="button"
                disabled={!now}
                onClick={() => onOpenItem(it.id)}
                title={now ? `Open this ${meta.label.toLowerCase()}` : 'This item was deleted'}
                style={toneVars(meta.tone)}
                className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-line bg-(--tone-soft) px-2 py-0.5 text-(--tone-fg) text-small transition-colors duration-fast hover:border-line-hover disabled:cursor-default disabled:opacity-60"
              >
                {meta.icon && <Icon icon={meta.icon} className="size-3.5 shrink-0" />}
                <span className="truncate">{now?.title ?? it.title}</span>
                {!now && <span>(deleted)</span>}
              </button>
            )
          })}
        </span>
      )}
      {point.quotes.map((q) => (
        <QuoteButton
          key={`${q.segmentId}:${q.quote}`}
          quote={q}
          selfName={selfName}
          onOpen={() => onOpenMeeting(q.meetingId, q.segmentId)}
        />
      ))}
    </li>
  )
}

/** A verbatim transcript quote; opens its meeting at that line. Styled like the meeting page's evidence quotes. */
function QuoteButton({ quote: q, selfName, onOpen }: { quote: AnswerQuote; selfName?: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open in “${q.meetingTitle}”: “${q.quote}”, ${q.speaker} at ${fmtTime(q.t)}`}
      style={{ borderLeftColor: `var(--color-${speakerHue(q.speaker, selfName)}-solid)` }}
      className="group flex w-full cursor-pointer flex-col gap-1 rounded-r-md border-l-2 py-1 pr-2 pl-3 text-left transition-colors duration-fast hover:bg-hover"
    >
      <span className="text-fg text-reading">“{q.quote}”</span>
      <span className="flex items-center gap-1.5 text-fg-tertiary text-small">
        — {q.speaker} · {q.meetingTitle} · <span className="font-mono tabular-nums">{fmtTime(q.t)}</span>
        <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100">
          <Icon icon={CornerDownRight} className="size-3" />
          Open in meeting
        </span>
      </span>
    </button>
  )
}
