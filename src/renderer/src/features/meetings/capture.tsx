import { type ReactNode, useState } from 'react'
import { api } from '../../api'
import { Banner, Button, Dialog, Field, Input, Textarea } from '../../components/ui'
import { useAction } from '../../hooks/useAction'

const PASTE_PLACEHOLDER =
  'Priya: We need SSO for the enterprise tier.\nRahul: Agreed. Let us push the launch to November 20.\n\nTeams/Zoom/Meet .vtt exports also work.'

/**
 * The ways to get a meeting into a project other than recording it: paste a transcript, import a transcript file
 * (.vtt/.srt/.txt), or import an audio or video recording. Shared by the top bar's Capture menu and the Meetings tab.
 * Render `dialog` somewhere; it is the paste dialog while it's open.
 */
export function useCaptureActions(projectId: string | null, onOpenMeeting: (meetingId: string) => void) {
  const [paste, setPaste] = useState<{ title: string; text: string } | null>(null)
  const pickFile = useAction()
  const importAudio = useAction()

  const dialog: ReactNode =
    paste && projectId ? (
      <PasteTranscriptDialog
        initial={paste}
        onClose={() => setPaste(null)}
        onImport={async (title, text) => {
          const m = await api.importTranscript(projectId, title, text)
          setPaste(null)
          onOpenMeeting(m.id)
        }}
      />
    ) : null

  return {
    pasteTranscript: () => setPaste({ title: `Meeting · ${new Date().toLocaleDateString()}`, text: '' }),
    importTranscriptFile: () =>
      void pickFile.run(async () => {
        const f = await api.pickTranscriptFile()
        if (f) setPaste({ title: f.name.replace(/\.[^.]+$/, ''), text: f.text })
      }),
    importRecording: () =>
      void importAudio.run(async () => {
        if (!projectId) return
        const id = await api.importAudio(projectId)
        if (id) onOpenMeeting(id)
      }),
    pickingFile: pickFile.busy,
    importingRecording: importAudio.busy,
    error: pickFile.error ?? importAudio.error,
    dialog
  }
}

/** On failure the dialog stays open with the error, so the pasted text isn't lost. */
function PasteTranscriptDialog(props: {
  initial: { title: string; text: string }
  onClose: () => void
  onImport: (title: string, text: string) => Promise<void>
}) {
  const [title, setTitle] = useState(props.initial.title)
  const [text, setText] = useState(props.initial.text)
  const { run, busy, error } = useAction()
  return (
    <Dialog
      title="Import transcript"
      size="lg"
      onClose={props.onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!text.trim()}
            onClick={() => void run(() => props.onImport(title.trim() || 'Meeting', text))}
          >
            Import
          </Button>
        </>
      }
    >
      <Field label="Meeting title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Transcript" hint="One line per statement, as Speaker: text. Teams, Zoom and Meet .vtt exports also work.">
        <Textarea minRows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={PASTE_PLACEHOLDER} data-autofocus />
      </Field>
      {error && <Banner tone="danger">{error}</Banner>}
    </Dialog>
  )
}
