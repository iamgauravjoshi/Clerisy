import { ClipboardPaste, FileAudio, FileText, Mic } from 'lucide-react'
import { useEffect } from 'react'
import { SplitButton, useToast } from '../../components/ui'
import { useCaptureActions } from './capture'

/**
 * The top bar's Capture button (from the kit's "Capture ▾"): Record meeting, with paste and import in its menu.
 * Imports go into the current project, so the menu is disabled when there isn't one.
 */
export function CaptureMenu({
  projectId,
  canRecord,
  onRecord,
  onOpenMeeting
}: {
  projectId: string | null
  canRecord: boolean
  onRecord: () => void
  onOpenMeeting: (meetingId: string) => void
}) {
  const capture = useCaptureActions(projectId, onOpenMeeting)
  const { show } = useToast()
  const busy = capture.pickingFile || capture.importingRecording
  const noProject = !projectId

  useEffect(() => {
    if (capture.error) show({ tone: 'danger', title: 'Import failed', body: capture.error })
  }, [capture.error, show])
  useEffect(() => {
    if (capture.importingRecording)
      show({ tone: 'info', title: 'Transcribing the recording…', body: 'The meeting opens when the transcript is ready.' })
  }, [capture.importingRecording, show])

  return (
    <>
      <SplitButton
        label="Record meeting"
        icon={Mic}
        onClick={onRecord}
        disabled={!canRecord}
        menuLabel="More ways to add a meeting"
        items={[
          { label: 'Paste transcript…', icon: ClipboardPaste, onSelect: capture.pasteTranscript, disabled: noProject },
          { label: 'Import transcript file…', icon: FileText, onSelect: capture.importTranscriptFile, disabled: noProject || busy },
          { label: 'Import recording…', icon: FileAudio, onSelect: capture.importRecording, disabled: noProject || busy }
        ]}
      />
      {capture.dialog}
    </>
  )
}
